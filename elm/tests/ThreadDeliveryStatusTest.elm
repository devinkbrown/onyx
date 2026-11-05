module ThreadDeliveryStatusTest exposing (suite)

import App exposing (ChatMessage, Model, blank)
import Dict
import Expect
import Html
import Html.Attributes as Attr
import Set
import Test exposing (Test, describe, test)
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View.Thread as Thread


row : Int -> String -> Maybe String -> Bool -> ChatMessage
row id body outboxId pending =
    { id = id
    , from = "alice"
    , body = body
    , whisper = False
    , audience = Nothing
    , highlight = False
    , plaintext = Nothing
    , outboxId = outboxId
    , pending = pending
    , at = 1
    , msgid = Nothing
    , reactions = []
    , edited = False
    , deleted = False
    , redacted = False
    , topic = ""
    , msgType = "msg"
    , replyTo = Nothing
    }


threadModel : Model
threadModel =
    let
        parentBase =
            row 10 "uncertain body" (Just "old-label") True

        parent =
            { parentBase | msgid = Just "parent-10" }

        queuedReplyBase =
            row 11 "queued body" (Just "queued-label") True

        queuedReply =
            { queuedReplyBase
                | replyTo = Just { id = "parent-10", from = "alice", text = "uncertain body" }
            }

        acceptedReplyBase =
            row 12 "confirmed body" Nothing False

        acceptedReply =
            { acceptedReplyBase
                | replyTo = Just { id = "parent-10", from = "alice", text = "uncertain body" }
            }

        messages =
            [ parent, queuedReply, acceptedReply ]

        channel =
            { name = "#delivery"
            , topic = ""
            , members = Dict.empty
            , modes = ""
            , messages = messages
            , lastSeen = Nothing
            , unread = 0
            , highlights = 0
            , createdAt = Nothing
            }
    in
    { blank
        | activeChannel = Just "#delivery"
        , channels = Dict.singleton "#delivery" channel
        , deliveryUnknownIds = Set.singleton 10
    }


query : Model -> Query.Single App.Msg
query model =
    Html.div [] [ Thread.thread model ]
        |> Query.fromHtml


messageRow : Int -> Query.Single App.Msg -> Query.Single App.Msg
messageRow id root =
    Query.find [ Selector.attribute (Attr.attribute "data-message-id" (String.fromInt id)) ] root


suite : Test
suite =
    describe "thread delivery status"
        [ test "unknown is explicit and accessible while queued and accepted rows keep their own states" <|
            \_ ->
                let
                    rendered =
                        query threadModel

                    unknown =
                        messageRow 10 rendered

                    queued =
                        messageRow 11 rendered

                    accepted =
                        messageRow 12 rendered

                    sheet =
                        query (Tuple.first (App.update (App.ThreadOpen { channel = "#delivery", parentId = 10 }) threadModel))

                    parentCard =
                        Query.find
                            [ Selector.attribute (Attr.attribute "aria-label" "Thread parent: Delivery outcome unknown. alice: uncertain body") ]
                            sheet

                    queuedReplyCard =
                        Query.find
                            [ Selector.attribute (Attr.attribute "aria-label" "Thread reply: alice (queued): queued body") ]
                            sheet

                    acceptedReplyCard =
                        Query.find
                            [ Selector.attribute (Attr.attribute "aria-label" "Thread reply: alice: confirmed body") ]
                            sheet
                in
                Expect.all
                    [ \_ ->
                        Query.has
                            [ Selector.text "Delivery outcome unknown"
                            , Selector.attribute (Attr.attribute "aria-label" "Delivery outcome unknown. alice: uncertain body")
                            , Selector.class "onyx-uncertain"
                            ]
                            unknown
                    , \_ -> Query.hasNot [ Selector.text "queued" ] unknown
                    , \_ -> Query.has [ Selector.text "queued" ] queued
                    , \_ -> Query.hasNot [ Selector.text "Delivery outcome unknown", Selector.class "onyx-uncertain" ] queued
                    , \_ -> Query.hasNot [ Selector.text "queued" ] accepted
                    , \_ -> Query.hasNot [ Selector.text "Delivery outcome unknown" ] accepted
                    , \_ -> Query.hasNot [ Selector.class "onyx-pending" ] accepted
                    , \_ -> Query.has [ Selector.text "Delivery outcome unknown" ] parentCard
                    , \_ -> Query.hasNot [ Selector.text "queued" ] parentCard
                    , \_ -> Query.has [ Selector.text "queued" ] queuedReplyCard
                    , \_ -> Query.hasNot [ Selector.text "Delivery outcome unknown" ] queuedReplyCard
                    , \_ -> Query.hasNot [ Selector.text "queued" ] acceptedReplyCard
                    , \_ -> Query.hasNot [ Selector.text "Delivery outcome unknown" ] acceptedReplyCard
                    ]
                    ()
        ]

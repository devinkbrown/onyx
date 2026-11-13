module UiAuditClaudeTest exposing (suite)

{-| UI audit (conversation surface): transcript list structure, live
regions, row labels, menu roles, boost semantics, media names and the
skip link.
-}

import App exposing (ChatMessage, Model, blank)
import Dict
import Expect
import Html
import Html.Attributes as Attr
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View.Thread as Thread


dayMs : Int
dayMs =
    24 * 60 * 60 * 1000


row : Int -> String -> String -> Int -> ChatMessage
row id from body at =
    { id = id
    , from = from
    , body = body
    , whisper = False
    , audience = Nothing
    , highlight = False
    , plaintext = Nothing
    , outboxId = Nothing
    , pending = False
    , at = at
    , msgid = Just ("m" ++ String.fromInt id)
    , reactions = []
    , edited = False
    , deleted = False
    , redacted = False
    , topic = ""
    , msgType = "msg"
    , replyTo = Nothing
    }


{-| `messages` is newest-first, like `Channel.messages` in the model
(new rows are consed onto the head). The clock sits just after the
fixture rows so they count as recent. -}
withMessages : List ChatMessage -> Model
withMessages messages =
    let
        channel =
            { name = "#c"
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
        | activeChannel = Just "#c"
        , ourNick = "me"
        , channels = Dict.singleton "#c" channel
        , nowMs = 5000
    }


{-| Two days of rows, a system event and an unread boundary: every
kind of child the transcript list can hold. -}
mixedModel : Model
mixedModel =
    let
        joinBase =
            row 2 "carol joined" "carol joined" (dayMs + 1000)

        join =
            { joinBase | msgType = "join", msgid = Nothing }

        model =
            withMessages
                [ row 4 "alice" "later" (dayMs + 3000)
                , row 3 "bob" "second day" (dayMs + 2000)
                , join
                , row 1 "alice" "first" 1000
                ]
    in
    { model | viewUnreadDividerId = Dict.singleton "#c" 3 }


query : Model -> Query.Single App.Msg
query model =
    Html.div [] [ Thread.thread model ]
        |> Query.fromHtml


menuQuery : Model -> Query.Single App.Msg
menuQuery model =
    Html.div [] [ Thread.messageMenuLayer model ]
        |> Query.fromHtml


messageRow : Int -> Query.Single App.Msg -> Query.Single App.Msg
messageRow id root =
    Query.find [ Selector.attribute (Attr.attribute "data-message-id" (String.fromInt id)) ] root


suite : Test
suite =
    describe "UI audit: conversation surface"
        [ test "every direct child of the transcript list is an li (dividers and system rows included)" <|
            \_ ->
                let
                    children =
                        query mixedModel
                            |> Query.find [ Selector.class "onyx-thread" ]
                            |> Query.children []
                in
                Expect.all
                    [ \c -> Query.each (Query.has [ Selector.tag "li" ]) c
                    , \c -> Query.count (Expect.atLeast 6) c
                    , \_ ->
                        query mixedModel
                            |> Query.find [ Selector.class "onyx-thread" ]
                            |> Query.findAll [ Selector.class "onyx-unread-divider", Selector.attribute (Attr.attribute "role" "separator") ]
                            |> Query.count (Expect.equal 1)
                    , \_ ->
                        query mixedModel
                            |> Query.find [ Selector.tag "li", Selector.class "onyx-system" ]
                            |> Query.has [ Selector.attribute (Attr.attribute "role" "article") ]
                    ]
                    children
        , test "the typing status is always mounted, empty while nobody types" <|
            \_ ->
                query mixedModel
                    |> Query.find [ Selector.class "onyx-typing" ]
                    |> Expect.all
                        [ Query.has [ Selector.attribute (Attr.attribute "role" "status") ]
                        , Query.children [] >> Query.count (Expect.equal 0)
                        ]
        , test "row labels carry the row time" <|
            \_ ->
                let
                    clock =
                        App.formatRowClock mixedModel.zone mixedModel.prefs.clock 1000
                in
                query mixedModel
                    |> messageRow 1
                    |> Query.has [ Selector.attribute (Attr.attribute "aria-label" ("alice: first, " ++ clock)) ]
        , test "quick reactions in the message menu are menu items" <|
            \_ ->
                let
                    model =
                        { mixedModel | messageMenu = Just { target = "#c", msgid = "m1", confirmDelete = False, more = False, x = 0, y = 0 } }

                    emojis =
                        menuQuery model
                            |> Query.find [ Selector.attribute (Attr.attribute "role" "menu") ]
                            |> Query.findAll [ Selector.class "onyx-msg-menu-emoji" ]
                in
                Expect.all
                    [ Query.count (Expect.equal 6)
                    , Query.each (Query.has [ Selector.attribute (Attr.attribute "role" "menuitem") ])
                    ]
                    emojis
        , test "the boost bar is a named group and chips keep a stable name" <|
            \_ ->
                let
                    boosted =
                        row 1 "alice" "hi" 1000

                    model =
                        withMessages [ { boosted | reactions = [ { emoji = "👍", users = [ "bob", "me" ] } ] } ]

                    bar =
                        query model |> Query.find [ Selector.class "boost-bar" ]
                in
                Expect.all
                    [ Query.has [ Selector.attribute (Attr.attribute "role" "group"), Selector.attribute (Attr.attribute "aria-label" "Boosts") ]
                    , Query.find [ Selector.tag "button", Selector.class "boost-pill" ]
                        >> Query.has
                            [ Selector.attribute (Attr.attribute "aria-label" "👍, 2 boosts")
                            , Selector.attribute (Attr.attribute "aria-pressed" "true")
                            ]
                    ]
                    bar
        , test "an incoming message from someone else is announced politely" <|
            \_ ->
                query (withMessages [ row 2 "bob" "hello there" 2000, row 1 "me" "mine" 1000 ])
                    |> Query.find [ Selector.class "onyx-incoming-announcer" ]
                    |> Expect.all
                        [ Query.has [ Selector.attribute (Attr.attribute "aria-live" "polite"), Selector.attribute (Attr.attribute "role" "status") ]
                        , Query.has [ Selector.text "bob: hello there" ]
                        ]
        , test "own echoes, system rows and old history stay silent" <|
            \_ ->
                let
                    joinBase =
                        row 3 "carol" "carol joined" 3000

                    oldModel =
                        withMessages [ row 1 "bob" "old news" 1000 ]

                    edited =
                        row 4 "bob" "fixed typo" 4000

                    freshModel =
                        withMessages [ row 4 "bob" "replayed" 4000 ]

                    silentText model =
                        query model
                            |> Query.find [ Selector.class "onyx-incoming-announcer" ]
                            |> Query.children []
                            |> Query.count (Expect.equal 0)
                in
                Expect.all
                    [ \_ -> silentText (withMessages [ row 2 "me" "my echo" 2000, row 1 "bob" "hi" 1000 ])
                    , \_ -> silentText (withMessages [ { joinBase | msgType = "join" }, row 1 "bob" "hi" 1000 ])
                    , \_ -> silentText { oldModel | nowMs = toFloat (10 * dayMs) }
                    , \_ -> silentText (withMessages [ { edited | edited = True } ])
                    , \_ -> silentText { freshModel | nowMs = 0 }
                    ]
                    ()
        , test "history backfilled at the tail leaves the announcement on the newest row" <|
            \_ ->
                let
                    announced model =
                        query model
                            |> Query.find [ Selector.class "onyx-incoming-announcer" ]
                in
                Expect.all
                    [ \_ ->
                        announced (withMessages [ row 3 "bob" "newest" 3000, row 2 "me" "mine" 2000, row 1 "carol" "backfilled" 1000 ])
                            |> Expect.all
                                [ Query.has [ Selector.text "bob: newest" ]
                                , Query.hasNot [ Selector.text "carol: backfilled" ]
                                ]
                    , \_ ->
                        announced (withMessages [ row 3 "me" "newest mine" 3000, row 1 "carol" "backfilled" 1000 ])
                            |> Query.children []
                            |> Query.count (Expect.equal 0)
                    ]
                    ()
        , test "a skip link above the transcript focuses the composer" <|
            \_ ->
                query mixedModel
                    |> Query.find [ Selector.class "onyx-skip-composer" ]
                    |> Event.simulate Event.click
                    |> Event.expect App.ThreadSkipToComposer
        , test "skipping to the composer focuses the message field" <|
            \_ ->
                App.update App.ThreadSkipToComposer mixedModel
                    |> Tuple.second
                    |> Expect.equal [ App.FocusElement "onyx-composer-input" ]
        ]

module GapImportViewTest exposing (suite)

{-| v3/gap-import — the pieces the logic modules cannot show on their
own: the Import & export pane (every phase), the review's include /
destination / confirm behaviour through the real `App.update`, the
BlockKit card inside a conversation (valid, off-origin, hostile), and
the send-review dialog with its one-message confirm.
-}

import App exposing (..)
import BlockKit
import Dict
import Expect
import HistoryImport as HI
import Html
import Html.Attributes
import Json.Encode as E
import PrefsPanel exposing (Category(..))
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View


feed : Model -> String -> Model
feed model line =
    Tuple.first (update (WsLineReceived line) model)


step : Msg -> Model -> Model
step msg model =
    Tuple.first (update msg model)


stepOut : Msg -> Model -> ( Model, List Outbound )
stepOut =
    update


inRoom : Model
inRoom =
    { blank | caps = [] }
        |> (\m -> feed m ":me!u@h JOIN #c")
        |> step (ChannelSelect "#c")


query : Model -> Query.Single Msg
query model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


attr : String -> String -> Selector.Selector
attr name value =
    Selector.attribute (Html.Attributes.attribute name value)


testId : String -> Selector.Selector
testId =
    attr "data-testid"



-- IMPORT PANE


transferOpen : Model
transferOpen =
    { inRoom | prefsOpen = True, prefsCategory = Transfer }


stagedJson : Int -> E.Value
stagedJson job =
    let
        row id from text time dup =
            E.object
                [ ( "id", E.string id )
                , ( "from", E.string from )
                , ( "text", E.string text )
                , ( "type", E.string "msg" )
                , ( "time", E.int time )
                , ( "print", E.string "0123abcd" )
                , ( "dup", E.bool dup )
                ]

        conv key source suggested dm rows =
            E.object
                [ ( "key", E.string key )
                , ( "source", E.string source )
                , ( "suggested", E.string suggested )
                , ( "dm", E.bool dm )
                , ( "rows", E.list identity rows )
                ]
    in
    E.object
        [ ( "job", E.int job )
        , ( "result"
          , E.object
                [ ( "kind", E.string "discord" )
                , ( "label", E.string "Synthetic Guild" )
                , ( "files", E.int 2 )
                , ( "conversations"
                  , E.list identity
                        [ conv "discord:1"
                            "Synthetic Guild · #General"
                            "#general"
                            False
                            [ row "a1" "ana" "hello" 1704189600000 False
                            , row "a2" "bo" "hi" 1704189660000 False
                            , row "a3" "ana" "again" 1704189720000 True
                            ]
                        , conv "discord:2" "Direct Messages · bo" "bo" True [ row "d1" "bo" "psst" 1706774400000 False ]
                        ]
                  )
                ]
          )
        ]


reviewing : Model
reviewing =
    transferOpen
        |> step (HistoryImportMsg (HI.Choose HI.Discord))
        |> step (HistoryImportMsg (HI.GotStaged (stagedJson 1)))


paneTests : Test
paneTests =
    describe "Import & export pane"
        [ test "idle: four sources, one choose button, the portable vault, no review" <|
            \_ ->
                Expect.all
                    [ \q -> q |> Query.has [ testId "history-import" ]
                    , \q -> q |> Query.findAll [ attr "role" "radio" ] |> Query.count (Expect.atLeast 4)
                    , \q -> q |> Query.has [ Selector.text "Choose Discord JSON files" ]
                    , \q -> q |> Query.has [ Selector.text "Export vault" ]
                    , \q -> q |> Query.has [ Selector.text "Import portable JSON" ]
                    , \q -> q |> Query.hasNot [ testId "history-import-review" ]
                    ]
                    (query transferOpen)
        , test "choosing a source swaps the blurb and the button label" <|
            \_ ->
                transferOpen
                    |> step (HistoryImportMsg (HI.SelectSource HI.Slack))
                    |> query
                    |> Expect.all
                        [ \q -> q |> Query.has [ Selector.text "Choose export folder" ]
                        , \q -> q |> Query.has [ Selector.id "history-import-source-slack", attr "aria-checked" "true" ]
                        ]
        , test "the choose button asks for the picker through the port" <|
            \_ ->
                transferOpen
                    |> query
                    |> Query.find [ testId "history-import-choose" ]
                    |> Event.simulate Event.click
                    |> Event.expect (HistoryImportMsg (HI.Choose HI.Discord))
        , test "waiting for the picker shows Cancel and disables choose" <|
            \_ ->
                transferOpen
                    |> step (HistoryImportMsg (HI.Choose HI.Discord))
                    |> query
                    |> Expect.all
                        [ \q -> q |> Query.has [ testId "history-import-activity", Selector.text "Waiting for your files" ]
                        , \q -> q |> Query.find [ testId "history-import-choose" ] |> Query.has [ Selector.disabled True ]
                        ]
        , test "progress shows a labelled progress bar with the percentage" <|
            \_ ->
                transferOpen
                    |> step (HistoryImportMsg (HI.Choose HI.Discord))
                    |> step (HistoryImportMsg (HI.Progress { job = 1, phase = "parsing", done = 50, total = 200, files = 3 }))
                    |> query
                    |> Expect.all
                        [ \q -> q |> Query.has [ attr "role" "progressbar", attr "aria-valuenow" "25" ]
                        , \q -> q |> Query.has [ Selector.text "Reading 3 files… 25%" ]
                        ]
        , test "a failure is announced as an alert and can be dismissed" <|
            \_ ->
                transferOpen
                    |> step (HistoryImportMsg (HI.Choose HI.Discord))
                    |> step (HistoryImportMsg (HI.Failed { job = 1, message = "Could not read those files." }))
                    |> query
                    |> Query.find [ testId "history-import-status" ]
                    |> Expect.all
                        [ Query.has [ attr "role" "alert", Selector.text "Could not read those files." ]
                        , \single -> single |> Query.find [ Selector.attribute (Html.Attributes.attribute "aria-label" "Dismiss message") ] |> Event.simulate Event.click |> Event.expect (HistoryImportMsg HI.DismissStatus)
                        ]
        ]


reviewTests : Test
reviewTests =
    describe "review"
        [ test "shows the counts, one row per conversation and the destination inputs" <|
            \_ ->
                query reviewing
                    |> Expect.all
                        [ \q -> q |> Query.has [ testId "history-import-review", Selector.text "Review before importing" ]
                        , \q -> q |> Query.findAll [ testId "history-import-conversation" ] |> Query.count (Expect.equal 2)
                        , \q -> q |> Query.has [ Selector.text "Import 3 messages" ]
                        , \q -> q |> Query.has [ Selector.text "2 new messages, 1 already here" ]
                        , \q -> q |> Query.has [ Selector.id "history-import-dest-discord:1", Selector.attribute (Html.Attributes.value "#general") ]
                        , \q -> q |> Query.hasNot [ testId "history-import-choose" ]
                        ]
        , test "typing a destination reaches the logic; an invalid one is flagged inline" <|
            \_ ->
                let
                    typed =
                        reviewing |> step (HistoryImportMsg (HI.SetDest "discord:1" "not a room!"))
                in
                query typed
                    |> Expect.all
                        [ \q -> q |> Query.has [ Selector.text "Use a room like #name, or a person's nick." ]
                        , \q -> q |> Query.find [ Selector.id "history-import-dest-discord:1" ] |> Query.has [ attr "aria-invalid" "true" ]
                        ]
        , test "rows beyond the device's retention are called out and left out of the count" <|
            \_ ->
                let
                    tight =
                        { reviewing | retentionPolicy = { keep = 1, perChannel = Dict.empty, maxAgeDays = Nothing } }
                in
                query tight
                    |> Expect.all
                        [ \q -> q |> Query.has [ testId "history-import-trimmed", Selector.text "1 older message fall outside the history this device keeps (1 per conversation" ]
                        , \q -> q |> Query.has [ Selector.text "Import 2 messages" ]
                        ]
        , test "an invalid destination turns the primary action into 'Fix destinations'" <|
            \_ ->
                let
                    bad =
                        reviewing |> step (HistoryImportMsg (HI.SetDest "discord:1" "not a room!"))
                in
                query bad
                    |> Query.find [ testId "history-import-confirm" ]
                    |> Expect.all
                        [ Query.has [ Selector.text "Fix destinations", Selector.disabled False ]
                        , Event.simulate Event.click >> Event.expect (HistoryImportMsg HI.Confirm)
                        ]
        , test "leaving a conversation out updates the count and disables an empty import" <|
            \_ ->
                let
                    none =
                        reviewing |> step (HistoryImportMsg (HI.IncludeAll False))
                in
                query none
                    |> Expect.all
                        [ \q -> q |> Query.has [ Selector.text "Nothing new to import" ]
                        , \q -> q |> Query.find [ testId "history-import-confirm" ] |> Query.has [ Selector.disabled True ]
                        , \q -> q |> Query.has [ Selector.text "Select all" ]
                        ]
        , test "Cancel writes nothing and returns to the sources" <|
            \_ ->
                let
                    ( cancelled, outs ) =
                        stepOut (HistoryImportMsg HI.Cancel) reviewing
                in
                Expect.all
                    [ \_ -> query cancelled |> Query.has [ testId "history-import" ]
                    , \_ -> query cancelled |> Query.has [ Selector.text "Import cancelled. Nothing was written." ]
                    , \_ -> Expect.equal [] (List.filter isPersist outs)
                    ]
                    ()
        , test "Import writes only the new rows through the vault port, records the batch and offers Undo" <|
            \_ ->
                let
                    ( done, outs ) =
                        stepOut (HistoryImportMsg HI.Confirm) reviewing

                    persisted =
                        List.filterMap
                            (\o ->
                                case o of
                                    VaultPersist r ->
                                        Just ( r.target, List.map .id r.rows )

                                    _ ->
                                        Nothing
                            )
                            outs
                in
                Expect.all
                    [ \_ -> Expect.equal [ ( "#general", [ "a1", "a2" ] ), ( "bo", [ "d1" ] ) ] persisted
                    , \_ -> Expect.equal True (List.any isRecord outs)
                    , \_ -> query done |> Query.has [ testId "history-import-undo" ]
                    , \_ -> query done |> Query.has [ testId "history-import-batch" ]
                    ]
                    ()
        , test "Undo removes the batch through the port" <|
            \_ ->
                let
                    imported =
                        reviewing |> step (HistoryImportMsg HI.Confirm)

                    ( _, outs ) =
                        stepOut (HistoryImportMsg HI.Undo) imported
                in
                Expect.equal True (List.any isRemove outs)
        ]


isPersist : Outbound -> Bool
isPersist o =
    case o of
        VaultPersist _ ->
            True

        _ ->
            False


isRecord : Outbound -> Bool
isRecord o =
    case o of
        HistoryImportRecord _ ->
            True

        _ ->
            False


isRemove : Outbound -> Bool
isRemove o =
    case o of
        HistoryImportRemove _ ->
            True

        _ ->
            False



-- BLOCKKIT IN A CONVERSATION


payload : E.Value
payload =
    E.object
        [ ( "title", E.string "Deploy v3.2" )
        , ( "text", E.string "Ready for review." )
        , ( "fields", E.list identity [ E.object [ ( "label", E.string "Build" ), ( "value", E.string "#4821" ) ] ] )
        , ( "selects"
          , E.list identity
                [ E.object
                    [ ( "label", E.string "Rollout" )
                    , ( "options", E.list identity [ E.object [ ( "label", E.string "Canary" ), ( "value", E.string "canary" ) ] ] )
                    , ( "action", E.object [ ( "type", E.string "select-notify" ), ( "target", E.string "#c" ), ( "value", E.string "rollout" ) ] )
                    ]
                ]
          )
        , ( "buttons"
          , E.list identity
                [ E.object [ ( "label", E.string "Dashboard" ), ( "url", E.string "https://status.example.org/deploys/4821" ) ]
                , E.object [ ( "label", E.string "Copy id" ), ( "value", E.string "build-4821" ) ]
                , E.object [ ( "label", E.string "Approve" ), ( "action", E.object [ ( "type", E.string "send" ), ( "target", E.string "#c" ), ( "value", E.string "approve 4821" ) ] ) ]
                , E.object [ ( "label", E.string "Elsewhere" ), ( "action", E.object [ ( "type", E.string "send" ), ( "target", E.string "#other" ), ( "value", E.string "nope" ) ] ) ]
                ]
          )
        ]


withBlock : E.Value -> Model
withBlock value =
    feed inRoom (":nova!n@h PRIVMSG #c :[onyx:block] " ++ E.encode 0 value)


approveAction : BlockKit.Action
approveAction =
    { kind = BlockKit.SendAction, target = "#c", value = Just "approve 4821" }


staged : Model
staged =
    withBlock payload
        |> step (BlockKitMsg (BlockKit.Stage { origin = "#c", action = approveAction, selected = Nothing, returnTo = "x" }))


blockTests : Test
blockTests =
    describe "BlockKit in a conversation"
        [ test "a valid payload renders a card, not the raw marker text" <|
            \_ ->
                query (withBlock payload)
                    |> Expect.all
                        [ \q -> q |> Query.has [ testId "blockkit-card", Selector.text "Deploy v3.2" ]
                        , \q -> q |> Query.has [ Selector.text "#4821" ]
                        , \q -> q |> Query.hasNot [ Selector.containing [ Selector.text "[onyx:block]" ] ]
                        ]
        , test "the URL button is a safe link that names its destination host" <|
            \_ ->
                query (withBlock payload)
                    |> Query.find [ Selector.class "bk-btn--link" ]
                    |> Expect.all
                        [ Query.has [ Selector.attribute (Html.Attributes.href "https://status.example.org/deploys/4821") ]
                        , Query.has [ attr "rel" "noopener noreferrer", attr "target" "_blank" ]
                        , Query.has [ Selector.text "status.example.org" ]
                        ]
        , test "an off-origin action renders disabled; an in-room one stays enabled" <|
            \_ ->
                query (withBlock payload)
                    |> Query.findAll [ Selector.class "bk-btn--action" ]
                    |> Expect.all
                        [ Query.count (Expect.equal 2)
                        , Query.index 0 >> Query.has [ Selector.text "Approve", Selector.disabled False ]
                        , Query.index 1 >> Query.has [ Selector.text "Elsewhere", Selector.disabled True ]
                        ]
        , test "a hostile payload (javascript: link) stays plain text with no card or link" <|
            \_ ->
                let
                    hostile =
                        E.object
                            [ ( "title", E.string "x" )
                            , ( "buttons", E.list identity [ E.object [ ( "label", E.string "Go" ), ( "url", E.string "javascript:alert(1)" ) ] ] )
                            ]
                in
                query (withBlock hostile)
                    |> Expect.all
                        [ \q -> q |> Query.hasNot [ testId "blockkit-card" ]
                        , \q -> q |> Query.has [ Selector.containing [ Selector.text "[onyx:block]" ] ]
                        , \q -> q |> Query.findAll [ Selector.tag "a", Selector.attribute (Html.Attributes.href "javascript:alert(1)") ] |> Query.count (Expect.equal 0)
                        ]
        , test "staging an action opens the review with the exact destination and text; nothing is sent yet" <|
            \_ ->
                let
                    ( opened, outs ) =
                        stepOut (BlockKitMsg (BlockKit.Stage { origin = "#c", action = approveAction, selected = Nothing, returnTo = "x" })) (withBlock payload)
                in
                Expect.all
                    [ \_ -> query opened |> Query.has [ testId "blockkit-review", Selector.text "Send message from structured control?" ]
                    , \_ -> query opened |> Query.find [ testId "blockkit-review" ] |> Query.has [ Selector.text "approve 4821", Selector.text "#c", Selector.text "This message will be sent as you." ]
                    , \_ -> Expect.equal [] (List.filter isSend outs)
                    ]
                    ()
        , test "Cancel closes the review without sending" <|
            \_ ->
                let
                    ( closed, outs ) =
                        stepOut (BlockKitMsg BlockKit.CancelReview) staged
                in
                Expect.all
                    [ \_ -> query closed |> Query.hasNot [ testId "blockkit-review" ]
                    , \_ -> Expect.equal [] (List.filter isSend outs)
                    ]
                    ()
        , test "Send sends exactly one PRIVMSG to the origin and closes the review" <|
            \_ ->
                let
                    ( sent, outs ) =
                        stepOut (BlockKitMsg BlockKit.ConfirmSend) staged

                    lines =
                        List.filterMap
                            (\o ->
                                case o of
                                    SendLine l ->
                                        Just l

                                    _ ->
                                        Nothing
                            )
                            outs
                in
                Expect.all
                    [ \_ -> Expect.equal 1 (List.length (List.filter (String.contains "approve 4821") lines))
                    , \_ -> Expect.equal True (List.any (String.contains "PRIVMSG #c") lines)
                    , \_ -> query sent |> Query.hasNot [ testId "blockkit-review" ]
                    , \_ -> Expect.equal "" sent.composer
                    ]
                    ()
        , test "Inspect structured data lists the fields, options and exact destinations" <|
            \_ ->
                let
                    open =
                        withBlock payload
                            |> step
                                (BlockKitMsg
                                    (BlockKit.OpenInspect
                                        { origin = "#c"
                                        , key = "k"
                                        , block = BlockKit.parse (E.encode 0 payload) |> Maybe.withDefault emptyBlock
                                        , openerId = "x"
                                        }
                                    )
                                )
                in
                query open
                    |> Query.find [ testId "blockkit-inspect-dialog" ]
                    |> Expect.all
                        [ Query.has [ Selector.text "Inspect structured data", Selector.text "Build", Selector.text "#4821" ]
                        , Query.has [ Selector.text "Sends “rollout: canary” to #c" ]
                        , Query.has [ Selector.text "Opens https://status.example.org/deploys/4821" ]
                        , Query.has [ Selector.text "Copies “build-4821”" ]
                        ]
        , test "Escape closes the review first, then the inspect dialog" <|
            \_ ->
                let
                    both =
                        staged
                            |> step (BlockKitMsg (BlockKit.OpenInspect { origin = "#c", key = "k", block = emptyBlock, openerId = "x" }))
                            |> step (BlockKitMsg (BlockKit.Stage { origin = "#c", action = approveAction, selected = Nothing, returnTo = "x" }))
                in
                Expect.all
                    [ \_ -> Expect.equal True (both.blockKit.review /= Nothing)
                    , \_ -> Expect.equal True ((step (BlockKitMsg BlockKit.Escape) both).blockKit.review == Nothing)
                    , \_ -> Expect.equal True ((step (BlockKitMsg BlockKit.Escape) both).blockKit.inspect /= Nothing)
                    ]
                    ()
        ]


emptyBlock : BlockKit.Block
emptyBlock =
    { kind = BlockKit.MessageBlock, title = Just "t", text = Nothing, fields = [], selects = [], buttons = [] }


isSend : Outbound -> Bool
isSend o =
    case o of
        SendLine l ->
            String.contains "PRIVMSG" l

        _ ->
            False


suite : Test
suite =
    describe "gap-import views"
        [ paneTests
        , reviewTests
        , blockTests
        ]

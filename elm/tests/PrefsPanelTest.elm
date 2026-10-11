module PrefsPanelTest exposing (suite)

{-| Vectors for the v3/prefs slice: the device Preferences sheet
(mirroring `src/shell/PreferencesPanel.test.tsx` for the ported
categories — tab list + keyboard model, segmented radios, switches,
default vault search mode, retention, queued-send and draft discard
with count re-confirmation, reset) plus the You-hub entry and the
`Hide join, part & quit` row filter.
-}

import App exposing (..)
import Dict
import Expect
import Html
import Html.Attributes
import Json.Encode
import Nav
import Prefs
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


inRoom : Model
inRoom =
    { blank | caps = [] }
        |> (\m -> feed m ":me!u@h JOIN #c")
        |> step (ChannelSelect "#c")


opened : Model
opened =
    { inRoom | prefsOpen = True }


query : Model -> Query.Single Msg
query model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


attr : String -> String -> Html.Attribute msg
attr name value =
    Html.Attributes.attribute name value


sheet : Model -> Query.Single Msg
sheet model =
    query model |> Query.find [ Selector.attribute (attr "data-testid" "preferences-panel") ]


row : String -> String -> Float -> OutboxEntry
row id target queuedAt =
    { id = id, target = target, text = "queued plaintext secret " ++ id, queuedAt = queuedAt }


withOutbox : List OutboxEntry -> Model -> Model
withOutbox rows model =
    { model | outbox = rows }


suite : Test
suite =
    describe "v3/prefs"
        [ pureVectors
        , openVectors
        , categoryVectors
        , prefVectors
        , queuedVectors
        , draftVectors
        , transferVectors
        ]


pureVectors : Test
pureVectors =
    describe "PrefsPanel helpers"
        [ test "countLabel pluralises like the oracle" <|
            \_ ->
                Expect.equal
                    [ PrefsPanel.countLabel 0 "queued send", PrefsPanel.countLabel 1 "queued send", PrefsPanel.countLabel 2 "room draft" ]
                    [ "0 queued sends", "1 queued send", "2 room drafts" ]
        , test "category keys wrap and jump (ArrowDown/Right, ArrowUp/Left, Home, End)" <|
            \_ ->
                Expect.equal
                    [ PrefsPanel.categoryAfterKey Display "ArrowDown"
                    , PrefsPanel.categoryAfterKey Display "ArrowRight"
                    , PrefsPanel.categoryAfterKey Display "ArrowUp"
                    , PrefsPanel.categoryAfterKey Accessibility "ArrowDown"
                    , PrefsPanel.categoryAfterKey History "ArrowDown"
                    , PrefsPanel.categoryAfterKey Conversation "End"
                    , PrefsPanel.categoryAfterKey Accessibility "Home"
                    , PrefsPanel.categoryAfterKey Display "Enter"
                    ]
                    [ Just Conversation, Just Conversation, Just Accessibility, Just Display, Just Transfer, Just Accessibility, Just Display, Nothing ]
        , test "segment keys rove within the radio group" <|
            \_ ->
                let
                    opts =
                        [ "hybrid", "exact", "semantic" ]
                in
                Expect.equal
                    [ PrefsPanel.segmentAfterKey opts "hybrid" "ArrowRight"
                    , PrefsPanel.segmentAfterKey opts "hybrid" "ArrowLeft"
                    , PrefsPanel.segmentAfterKey opts "semantic" "ArrowDown"
                    , PrefsPanel.segmentAfterKey opts "exact" "End"
                    , PrefsPanel.segmentAfterKey opts "exact" "Home"
                    , PrefsPanel.segmentAfterKey opts "exact" "x"
                    , PrefsPanel.segmentAfterKey [] "a" "ArrowRight"
                    ]
                    [ Just "exact", Just "semantic", Just "hybrid", Just "semantic", Just "hybrid", Nothing, Nothing ]
        , test "vault search mode labels keep oracle order" <|
            \_ ->
                Expect.equal (List.map Tuple.second PrefsPanel.vaultSearchModeLabels) [ "Text + related", "Exact", "Related terms" ]
        , test "room drafts exclude DMs and blanks and merge the live composer" <|
            \_ ->
                Expect.equal
                    (PrefsPanel.roomDrafts (Just ( "#Live", "typing" ))
                        (Dict.fromList [ ( "#a", "draft a" ), ( "dave", "dm draft" ), ( "&b", "  " ), ( "#live", "old" ) ])
                    )
                    [ ( "#a", "draft a" ), ( "#live", "typing" ) ]
        , test "an emptied live composer drops its stale stash" <|
            \_ ->
                Expect.equal (PrefsPanel.roomDrafts (Just ( "#a", "" )) (Dict.fromList [ ( "#a", "old" ) ])) []
        , test "hideEvents hides exactly join, part and quit" <|
            \_ ->
                Expect.equal
                    (List.map (PrefsPanel.hidesEvent True) [ "join", "part", "quit", "kick", "nick", "msg" ]
                        ++ [ PrefsPanel.hidesEvent False "join" ]
                    )
                    [ True, True, True, False, False, False, False ]
        , test "updatePreference accepts the sheet keys" <|
            \_ ->
                let
                    d =
                        Prefs.defaultPreferences
                in
                Expect.equal
                    [ (Prefs.updatePreference d "hideEvents" "true").hideEvents
                    , (Prefs.updatePreference d "reduceTransparency" "true").reduceTransparency
                    , (Prefs.updatePreference d "highContrast" "true").highContrast
                    , (Prefs.updatePreference d "readerMode" "true").readerMode
                    , (Prefs.updatePreference d "width" "full").width == Prefs.WidthFull
                    , (Prefs.updatePreference d "width" "huge").width == Prefs.WidthMeasured
                    ]
                    [ True, True, True, True, True, True ]
        ]


openVectors : Test
openVectors =
    describe "opening"
        [ test "the You hub lists Preferences under This device and dispatches it" <|
            \_ ->
                query { inRoom | youHubOpen = True }
                    |> Query.find [ Selector.attribute (attr "data-testid" "you-settings-open-preferences") ]
                    |> Event.simulate Event.click
                    |> Event.expect (YouHubGo Nav.YouPreferences)
        , test "YouHubGo Preferences closes the hub, opens the sheet, and refreshes the outbox" <|
            \_ ->
                let
                    ( next, out ) =
                        update (YouHubGo Nav.YouPreferences) { inRoom | youHubOpen = True }
                in
                Expect.equal ( next.youHubOpen, next.prefsOpen, out ) ( False, True, [ OutboxReview { discard = [], tag = "refresh" } ] )
        , test "closed sheet renders nothing" <|
            \_ ->
                query inRoom |> Query.hasNot [ Selector.attribute (attr "data-testid" "preferences-panel") ]
        , test "the sheet is a labelled modal dialog with a close control" <|
            \_ ->
                Expect.all
                    [ \q -> q |> Query.has [ Selector.attribute (attr "role" "dialog"), Selector.attribute (attr "aria-modal" "true") ]
                    , \q -> q |> Query.has [ Selector.text "Device preferences" ]
                    , \q ->
                        q
                            |> Query.find [ Selector.attribute (attr "aria-label" "Close preferences") ]
                            |> Event.simulate Event.click
                            |> Event.expect PrefsClose
                    ]
                    (sheet opened)
        , test "closing disarms staged confirmations" <|
            \_ ->
                let
                    next =
                        step PrefsClose { opened | prefsOutboxConfirm = Just 2, prefsDraftsConfirm = Just 1 }
                in
                Expect.equal ( next.prefsOpen, next.prefsOutboxConfirm, next.prefsDraftsConfirm ) ( False, Nothing, Nothing )
        ]


categoryVectors : Test
categoryVectors =
    describe "categories"
        [ test "shows one selected category pane, Display first, with the Appearance launcher" <|
            \_ ->
                Expect.all
                    [ \q -> q |> Query.findAll [ Selector.attribute (attr "role" "tab") ] |> Query.count (Expect.equal 5)
                    , \q -> q |> Query.findAll [ Selector.attribute (attr "role" "tabpanel") ] |> Query.count (Expect.equal 5)
                    , \q ->
                        q
                            |> Query.find [ Selector.id "pref-category-tab-display" ]
                            |> Query.has [ Selector.attribute (attr "aria-selected" "true"), Selector.attribute (Html.Attributes.tabindex 0) ]
                    , \q -> q |> Query.find [ Selector.id "pref-category-panel-display" ] |> Query.has [ Selector.attribute (Html.Attributes.hidden False) ]
                    , \q -> q |> Query.find [ Selector.id "pref-category-panel-history" ] |> Query.has [ Selector.attribute (Html.Attributes.hidden True) ]
                    , \q -> q |> Query.has [ Selector.attribute (attr "aria-label" "Open appearance settings") ]
                    , \q -> q |> Query.hasNot [ Selector.text "Export vault" ]
                    , \q -> q |> Query.has [ Selector.attribute (attr "data-testid" "pref-density-placeholder") ]
                    ]
                    (sheet opened)
        , test "selecting a tab swaps the visible pane" <|
            \_ ->
                let
                    q =
                        sheet (step (PrefsSelectCategory Transfer) opened)
                in
                Expect.all
                    [ \_ -> q |> Query.find [ Selector.id "pref-category-tab-transfer" ] |> Query.has [ Selector.attribute (attr "aria-selected" "true") ]
                    , \_ -> q |> Query.has [ Selector.text "Export vault" ]
                    , \_ -> q |> Query.has [ Selector.text "Import portable JSON" ]
                    , \_ -> q |> Query.hasNot [ Selector.attribute (attr "aria-label" "Open appearance settings") ]
                    ]
                    ()
        , test "clicking a tab dispatches its category" <|
            \_ ->
                sheet opened
                    |> Query.find [ Selector.id "pref-category-tab-history" ]
                    |> Event.simulate Event.click
                    |> Event.expect (PrefsSelectCategory History)
        , test "tab-list keys move selection and focus" <|
            \_ ->
                Expect.equal
                    (update (PrefsCategoryKey { current = Display, key = "ArrowDown" }) opened |> Tuple.mapFirst .prefsCategory)
                    ( Conversation, [ PrefsFocus { id = "pref-category-tab-conversation" } ] )
        , test "a tab keydown routes through PrefsCategoryKey" <|
            \_ ->
                sheet opened
                    |> Query.find [ Selector.id "pref-category-tab-display" ]
                    |> Event.simulate (Event.custom "keydown" (Html.Attributes.attribute "x" "y" |> always (encodeKey "End")))
                    |> Event.expect (PrefsCategoryKey { current = Display, key = "End" })
        ]


encodeKey : String -> Json.Encode.Value
encodeKey key =
    Json.Encode.object [ ( "key", Json.Encode.string key ) ]


prefVectors : Test
prefVectors =
    describe "preference controls"
        [ test "Hide join, part & quit is a named switch that persists through the shared fold" <|
            \_ ->
                let
                    pane =
                        sheet (step (PrefsSelectCategory Conversation) opened)

                    ( next, out ) =
                        update (PrefsTogglePref "hideEvents") opened
                in
                Expect.all
                    [ \_ ->
                        pane
                            |> Query.find [ Selector.attribute (attr "data-testid" "pref-toggle-hideEvents") ]
                            |> Query.has
                                [ Selector.attribute (attr "role" "switch")
                                , Selector.attribute (attr "aria-checked" "false")
                                , Selector.attribute (attr "aria-label" "Hide join, part & quit")
                                ]
                    , \_ -> Expect.equal next.prefs.hideEvents True
                    , \_ ->
                        Expect.equal (List.take 1 out)
                            [ AppearanceStorePrefs { json = Prefs.encodePreferences next.prefs } ]
                    ]
                    ()
        , test "accessibility switches toggle their own keys" <|
            \_ ->
                let
                    next =
                        opened
                            |> step (PrefsTogglePref "reduceMotion")
                            |> step (PrefsTogglePref "reduceTransparency")
                            |> step (PrefsTogglePref "highContrast")
                            |> step (PrefsTogglePref "bogus")
                in
                Expect.equal ( next.prefs.reduceMotion, next.prefs.reduceTransparency, next.prefs.highContrast ) ( True, True, True )
        , test "the Accessibility pane lists motion, transparency and contrast" <|
            \_ ->
                let
                    pane =
                        sheet (step (PrefsSelectCategory Accessibility) opened)
                in
                Expect.all
                    [ \_ -> pane |> Query.has [ Selector.attribute (attr "aria-label" "Reduce motion") ]
                    , \_ -> pane |> Query.has [ Selector.attribute (attr "aria-label" "Reduce transparency") ]
                    , \_ -> pane |> Query.has [ Selector.attribute (attr "aria-label" "Raise interface contrast") ]
                    , \_ -> pane |> Query.has [ Selector.attribute (attr "aria-label" "Background motion") ]
                    ]
                    ()
        , test "background motion selects a valid scene motion and stores it" <|
            \_ ->
                let
                    ( next, out ) =
                        update (PrefsSetSceneMotion "still") opened
                in
                Expect.equal ( next.sceneMotion, List.take 1 out ) ( Prefs.SceneStill, [ AppearanceStoreSceneMotion { value = "still" } ] )
        , test "an unknown scene motion is ignored" <|
            \_ ->
                Expect.equal (Tuple.second (update (PrefsSetSceneMotion "warp") opened)) []
        , test "clock radio group is a roving radiogroup writing through AppearanceSetPref" <|
            \_ ->
                let
                    group =
                        sheet opened |> Query.find [ Selector.attribute (attr "data-testid" "pref-clock") ]
                in
                Expect.all
                    [ \_ -> group |> Query.has [ Selector.attribute (attr "role" "radiogroup"), Selector.attribute (attr "aria-label" "Clock") ]
                    , \_ -> group |> Query.find [ Selector.id "pref-clock-24h" ] |> Query.has [ Selector.attribute (attr "aria-checked" "true"), Selector.attribute (Html.Attributes.tabindex 0) ]
                    , \_ -> group |> Query.find [ Selector.id "pref-clock-12h" ] |> Query.has [ Selector.attribute (Html.Attributes.tabindex -1) ]
                    , \_ ->
                        group
                            |> Query.find [ Selector.id "pref-clock-12h" ]
                            |> Event.simulate Event.click
                            |> Event.expect (AppearanceSetPref { key = "clock", value = "12h" })
                    , \_ ->
                        group
                            |> Query.find [ Selector.id "pref-clock-24h" ]
                            |> Event.simulate (Event.custom "keydown" (encodeKey "ArrowRight"))
                            |> Event.expect (PrefsSegmentKey { focusId = "pref-clock-12h" } (AppearanceSetPref { key = "clock", value = "12h" }))
                    ]
                    ()
        , test "segment key runs the selection then focuses the new radio" <|
            \_ ->
                let
                    ( next, out ) =
                        update (PrefsSegmentKey { focusId = "pref-clock-12h" } (AppearanceSetPref { key = "clock", value = "12h" })) opened
                in
                Expect.equal ( next.prefs.clock, List.reverse out |> List.head ) ( Prefs.Clock12h, Just (PrefsFocus { id = "pref-clock-12h" }) )
        , test "default search mode selects, persists, and applies live" <|
            \_ ->
                let
                    group =
                        sheet (step (PrefsSelectCategory History) opened)
                            |> Query.find [ Selector.attribute (attr "data-testid" "pref-vault-mode") ]

                    ( next, out ) =
                        update (SetVaultSearchMode SemanticVaultSearch) opened
                in
                Expect.all
                    [ \_ -> group |> Query.has [ Selector.attribute (attr "aria-label" "Default search mode") ]
                    , \_ -> group |> Query.findAll [ Selector.attribute (attr "role" "radio") ] |> Query.count (Expect.equal 3)
                    , \_ -> group |> Query.find [ Selector.id "pref-vault-mode-hybrid" ] |> Query.has [ Selector.attribute (attr "aria-checked" "true") ]
                    , \_ ->
                        group
                            |> Query.find [ Selector.id "pref-vault-mode-semantic" ]
                            |> Event.simulate Event.click
                            |> Event.expect (SetVaultSearchMode SemanticVaultSearch)
                    , \_ -> Expect.equal next.vaultSearchMode SemanticVaultSearch
                    , \_ -> Expect.equal True (List.member (VaultSearchModeSave { mode = "semantic" }) out)
                    ]
                    ()
        , test "retention controls are private framed and dispatch the existing folds" <|
            \_ ->
                let
                    pane =
                        sheet (step (PrefsSelectCategory History) opened)
                in
                Expect.all
                    [ \_ -> pane |> Query.has [ Selector.text "On-device history" ]
                    , \_ -> pane |> Query.has [ Selector.attribute (attr "aria-label" "Messages per conversation") ]
                    , \_ -> pane |> Query.has [ Selector.attribute (attr "aria-label" "Maximum local age") ]
                    , \_ ->
                        pane
                            |> Query.find [ Selector.id "pref-retention-keep-1000" ]
                            |> Event.simulate Event.click
                            |> Event.expect (RetentionKeepSelected "1000")
                    ]
                    ()
        , test "reset restores defaults, stores both slots, and re-announces" <|
            \_ ->
                let
                    dirty =
                        { opened | prefs = Prefs.updatePreference opened.prefs "hideEvents" "true", sceneMotion = Prefs.SceneOff }

                    ( once, out ) =
                        update PrefsReset dirty

                    twice =
                        step PrefsReset once
                in
                Expect.all
                    [ \_ -> Expect.equal ( once.prefs, once.sceneMotion ) ( Prefs.defaultPreferences, Prefs.SceneAdaptive )
                    , \_ -> Expect.equal (List.take 2 out) [ AppearanceStorePrefs { json = Prefs.encodePreferences Prefs.defaultPreferences }, AppearanceStoreSceneMotion { value = "adaptive" } ]
                    , \_ -> Expect.equal once.prefsResetAnnouncement "Preferences reset to defaults."
                    , \_ -> Expect.notEqual twice.prefsResetAnnouncement once.prefsResetAnnouncement
                    ]
                    ()
        , test "hidden join rows carry the hidden attribute in the thread" <|
            \_ ->
                let
                    joinMsg =
                        { id = 9001
                        , from = "bob"
                        , body = "bob joined"
                        , whisper = False
                        , audience = Nothing
                        , highlight = False
                        , plaintext = Nothing
                        , outboxId = Nothing
                        , pending = False
                        , at = 1
                        , msgid = Nothing
                        , reactions = []
                        , edited = False
                        , deleted = False
                        , redacted = False
                        , topic = ""
                        , msgType = "join"
                        , replyTo = Nothing
                        }

                    model =
                        { inRoom | channels = Dict.map (\_ c -> { c | messages = joinMsg :: c.messages }) inRoom.channels }

                    hiddenModel =
                        { model | prefs = Prefs.updatePreference model.prefs "hideEvents" "true" }

                    joinRow m =
                        query m |> Query.findAll [ Selector.class "onyx-system", Selector.attribute (attr "data-event" "join") ]
                in
                Expect.all
                    [ \_ -> joinRow model |> Query.each (Query.has [ Selector.attribute (Html.Attributes.hidden False) ])
                    , \_ -> joinRow hiddenModel |> Query.each (Query.has [ Selector.attribute (Html.Attributes.hidden True) ])
                    , \_ -> joinRow hiddenModel |> Query.count (Expect.atLeast 1)
                    ]
                    ()
        ]


queuedVectors : Test
queuedVectors =
    let
        two =
            withOutbox [ row "ob-1" "#c" 1, row "ob-2" "dave" 2 ] { opened | prefsCategory = History }
    in
    describe "queued sends"
        [ test "lists queued rows with a count and per-row discard" <|
            \_ ->
                let
                    card =
                        sheet two |> Query.find [ Selector.attribute (attr "data-testid" "pref-queued") ]
                in
                Expect.all
                    [ \_ -> card |> Query.has [ Selector.text "2 queued sends" ]
                    , \_ ->
                        card
                            |> Query.find [ Selector.attribute (attr "aria-label" "Discard queued send to dave") ]
                            |> Event.simulate Event.click
                            |> Event.expect (PrefsOutboxRemove "ob-2")
                    ]
                    ()
        , test "per-row remove deletes through storage and settles on the verified reply" <|
            \_ ->
                let
                    ( busy, out ) =
                        update (PrefsOutboxRemove "ob-2") two

                    settled =
                        step (PrefsOutboxReviewed { removed = [ "ob-2" ], rows = [ row "ob-1" "#c" 1 ], ok = True, tag = "one" }) busy
                in
                Expect.all
                    [ \_ -> Expect.equal out [ OutboxReview { discard = [ "ob-2" ], tag = "one" } ]
                    , \_ -> Expect.equal busy.prefsOutboxBusy True
                    , \_ -> Expect.equal (List.map .id settled.outbox) [ "ob-1" ]
                    , \_ -> Expect.equal settled.prefsOutboxBusy False
                    , \_ -> Expect.equal (Maybe.map .message settled.prefsOutboxStatus) (Just (PrefsPanel.discardedQueuedCopy 1))
                    ]
                    ()
        , test "an unknown or busy remove is ignored" <|
            \_ ->
                Expect.equal
                    [ Tuple.second (update (PrefsOutboxRemove "ob-9") two), Tuple.second (update (PrefsOutboxRemove "ob-1") { two | prefsOutboxBusy = True }) ]
                    [ [], [] ]
        , test "discard all stages the count, refreshes, focuses the confirm, and hides plaintext" <|
            \_ ->
                let
                    ( asked, out ) =
                        update PrefsOutboxDiscardAsk two

                    group =
                        sheet asked |> Query.find [ Selector.attribute (attr "aria-label" "Confirm discard queued sends") ]
                in
                Expect.all
                    [ \_ -> Expect.equal asked.prefsOutboxConfirm (Just 2)
                    , \_ -> Expect.equal out [ OutboxReview { discard = [], tag = "refresh" }, PrefsFocus { id = "pref-discard-queued-confirm" } ]
                    , \_ -> group |> Query.has [ Selector.text "Discard 2 queued sends? Their unsent message text will be removed from this device and will not be sent." ]
                    , \_ -> group |> Query.hasNot [ Selector.text "queued plaintext secret" ]
                    ]
                    ()
        , test "keep cancels with status and returns focus to the trigger" <|
            \_ ->
                let
                    ( kept, out ) =
                        update PrefsOutboxDiscardCancel (step PrefsOutboxDiscardAsk two)
                in
                Expect.equal ( kept.prefsOutboxConfirm, Maybe.map .message kept.prefsOutboxStatus, out )
                    ( Nothing, Just "Queued sends kept on this device.", [ PrefsFocus { id = "pref-discard-queued-trigger" } ] )
        , test "a drifted count re-stages instead of discarding" <|
            \_ ->
                let
                    asked =
                        step PrefsOutboxDiscardAsk two

                    drifted =
                        step (PrefsOutboxReviewed { removed = [], rows = [ row "ob-1" "#c" 1, row "ob-2" "dave" 2, row "ob-3" "#c" 3 ], ok = True, tag = "refresh" }) asked

                    ( confirmed, out ) =
                        update PrefsOutboxDiscardConfirm drifted
                in
                Expect.equal ( confirmed.prefsOutboxConfirm, Maybe.map .message confirmed.prefsOutboxStatus, out )
                    ( Just 3, Just "Queued send count changed to 3. Review the updated count and confirm again.", [] )
        , test "a matching confirm deletes every listed id and reports only after an empty readback" <|
            \_ ->
                let
                    withPlaceholder =
                        two
                            |> step (OutboxQueued { id = "ob-3", target = "#c", text = "queued later", queuedAt = 3 })
                            |> step PrefsOutboxDiscardAsk

                    ( busy, out ) =
                        update PrefsOutboxDiscardConfirm withPlaceholder

                    done =
                        update (PrefsOutboxReviewed { removed = [ "ob-3", "ob-1", "ob-2" ], rows = [], ok = True, tag = "all" }) busy

                    placeholders m =
                        Dict.get "#c" m.channels
                            |> Maybe.map (.messages >> List.filter (\msg -> msg.outboxId /= Nothing) >> List.length)
                in
                Expect.all
                    [ \_ -> Expect.equal out [ OutboxReview { discard = [ "ob-3", "ob-1", "ob-2" ], tag = "all" } ]
                    , \_ -> Expect.equal (placeholders busy) (Just 1)
                    , \_ -> Expect.equal (placeholders (Tuple.first done)) (Just 0)
                    , \_ -> Expect.equal (Tuple.first done).outbox []
                    , \_ -> Expect.equal (Tuple.first done).prefsOutboxConfirm Nothing
                    , \_ ->
                        Expect.equal (Maybe.map .message (Tuple.first done).prefsOutboxStatus)
                            (Just "Discarded 3 queued sends. Their unsent message text was removed from this device and will not be sent.")
                    , \_ -> Expect.equal (Tuple.second done) [ PrefsFocus { id = "pref-discard-queued-trigger" } ]
                    ]
                    ()
        , test "a failed discard keeps the confirmation open with an alert" <|
            \_ ->
                let
                    busy =
                        two |> step PrefsOutboxDiscardAsk |> step PrefsOutboxDiscardConfirm

                    failed =
                        step (PrefsOutboxReviewed { removed = [], rows = [], ok = False, tag = "all" }) busy
                in
                Expect.equal ( failed.prefsOutboxConfirm, failed.prefsOutboxStatus, List.length failed.outbox )
                    ( Just 2, Just { message = PrefsPanel.queuedDiscardFailedCopy, failure = True }, 2 )
        , test "a refresh reply replaces the mirror without touching status" <|
            \_ ->
                let
                    next =
                        step (PrefsOutboxReviewed { removed = [], rows = [ row "ob-7" "#c" 7 ], ok = True, tag = "refresh" }) two
                in
                Expect.equal ( List.map .id next.outbox, next.prefsOutboxStatus ) ( [ "ob-7" ], Nothing )
        , test "the trigger is disabled with nothing queued" <|
            \_ ->
                sheet { opened | prefsCategory = History }
                    |> Query.find [ Selector.id "pref-discard-queued-trigger" ]
                    |> Query.has [ Selector.attribute (Html.Attributes.disabled True) ]
        ]


draftVectors : Test
draftVectors =
    let
        drafted =
            { opened
                | prefsCategory = History
                , composer = "live room text"
                , composerDrafts = Dict.fromList [ ( "#other", "other draft" ), ( "dave", "dm draft remains" ) ]
            }
    in
    describe "local drafts"
        [ test "counts room drafts only and lists them" <|
            \_ ->
                let
                    card =
                        sheet drafted |> Query.find [ Selector.attribute (attr "data-testid" "pref-drafts") ]
                in
                Expect.all
                    [ \_ -> card |> Query.has [ Selector.text "2 room drafts" ]
                    , \_ -> card |> Query.hasNot [ Selector.text "dm draft remains" ]
                    , \_ ->
                        card
                            |> Query.find [ Selector.attribute (attr "aria-label" "Discard draft in #other") ]
                            |> Event.simulate Event.click
                            |> Event.expect (PrefsDraftDiscard "#other")
                    ]
                    ()
        , test "per-row discard drops one stored draft" <|
            \_ ->
                let
                    next =
                        step (PrefsDraftDiscard "#other") drafted
                in
                Expect.equal ( Dict.keys next.composerDrafts, next.composer ) ( [ "dave" ], "live room text" )
        , test "discarding the open room clears the live composer" <|
            \_ ->
                Expect.equal (step (PrefsDraftDiscard "#c") drafted).composer ""
        , test "a DM target is never discarded here" <|
            \_ ->
                Expect.equal (Dict.keys (step (PrefsDraftDiscard "dave") drafted).composerDrafts) [ "#other", "dave" ]
        , test "discard all re-confirms the count, then keeps DM drafts" <|
            \_ ->
                let
                    ( asked, askOut ) =
                        update PrefsDraftsDiscardAsk drafted

                    drifted =
                        { asked | composerDrafts = Dict.insert "#third" "x" asked.composerDrafts }

                    ( restaged, _ ) =
                        update PrefsDraftsDiscardConfirm drifted

                    ( done, doneOut ) =
                        update PrefsDraftsDiscardConfirm restaged
                in
                Expect.all
                    [ \_ -> Expect.equal ( asked.prefsDraftsConfirm, askOut ) ( Just 2, [ PrefsFocus { id = "pref-discard-drafts-confirm" } ] )
                    , \_ -> Expect.equal restaged.prefsDraftsConfirm (Just 3)
                    , \_ -> Expect.equal (Dict.toList done.composerDrafts) [ ( "dave", "dm draft remains" ) ]
                    , \_ -> Expect.equal done.composer ""
                    , \_ -> Expect.equal (Maybe.map .message done.prefsDraftsStatus) (Just "Discarded 3 room drafts from this device. Direct-message drafts were not changed.")
                    , \_ -> Expect.equal doneOut [ PrefsFocus { id = "pref-discard-drafts-trigger" } ]
                    ]
                    ()
        , test "keep local drafts cancels with status" <|
            \_ ->
                let
                    kept =
                        drafted |> step PrefsDraftsDiscardAsk |> step PrefsDraftsDiscardCancel
                in
                Expect.equal ( kept.prefsDraftsConfirm, Maybe.map .message kept.prefsDraftsStatus ) ( Nothing, Just "Local drafts kept on this device." )
        ]


transferVectors : Test
transferVectors =
    describe "import & export"
        [ test "export wires the existing vault export port and reports the result" <|
            \_ ->
                let
                    ( pending, out ) =
                        update PrefsVaultExport opened

                    done =
                        step (VaultExported { targets = 2, messages = 1 }) pending
                in
                Expect.equal ( out, pending.prefsTransferStatus, done.prefsTransferStatus )
                    ( [ VaultExportRequest ], Just "Preparing export…", Just "Exported 1 message from 2 conversations." )
        , test "import asks the history importer for a portable vault file (review follows)" <|
            \_ ->
                Expect.equal (Tuple.second (update PrefsVaultImport opened)) [ HistoryImportPick { job = 1, kind = "portable" } ]
        ]

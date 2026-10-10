module PolishTest exposing (suite)

{-| v3/polish — vectors mirroring the oracle `TimeScrubber.test.tsx`,
`FirstRunNotifyPrompt.test.tsx`, `AddToHomeScreenSheet.test.tsx`,
`UpdateAvailable.test.tsx`, `ReconnectStatusBanner.test.tsx` (Back
online only after a recovery), the `firstHour` persisted dismissal and
the composer More tools tray. Behavior runs through `App.update`; pure
helpers run directly.
-}

import App exposing (..)
import Boost
import Expect
import Html
import Html.Attributes as Attr
import Invite
import Json.Encode as Encode
import Media
import Notify
import Polish
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import Time
import View


query : Model -> Query.Single Msg
query model =
    View.view model |> .body |> Html.div [] |> Query.fromHtml


testid : String -> Selector.Selector
testid id =
    Selector.attribute (Attr.attribute "data-testid" id)


after : Msg -> Model -> Model
after msg model =
    Tuple.first (update msg model)


outs : Msg -> Model -> List Outbound
outs msg model =
    Tuple.second (update msg model)


pm : Polish.Msg -> Msg
pm =
    PolishMsg


utc : String -> String -> Float
utc date time =
    Maybe.withDefault -1 (Boost.dateTimeAtUtc date time)


tick : Float -> Model -> Model
tick ms model =
    after (Tick (Time.millisToPosix (round ms))) { model | nowMs = ms }


{-| A device that has never sent, never dismissed, never been live. -}
fresh : Model
fresh =
    { blank | polish = Polish.initial, notifyPermission = Notify.Default }


withPolish : (Polish.State -> Polish.State) -> Model -> Model
withPolish f model =
    { model | polish = f model.polish }


inRoom : Model -> Model
inRoom model =
    { model | activeChannel = Just "#root" }


pulseBody : List Int -> Int -> String
pulseBody hours total =
    Encode.encode 0
        (Encode.object
            [ ( "channel", Encode.string "#root" )
            , ( "hours", Encode.list Encode.int hours )
            , ( "totals", Encode.object [ ( "messages", Encode.int total ) ] )
            ]
        )


hasFlagSave : String -> List Outbound -> Bool
hasFlagSave key =
    List.member (PolishFlagSave { key = key })


suite : Test
suite =
    describe "v3/polish"
        [ scrubberPure
        , scrubberBehavior
        , toolsTray
        , firstRunNotify
        , firstHour
        , addToHomeScreen
        , updateAvailable
        , backOnline
        ]



-- TIME SCRUBBER


scrubberPure : Test
scrubberPure =
    describe "buildTimeScrubberBars / buildMomentLink"
        [ test "returns 24 quiet bars when stats are absent or malformed" <|
            \_ ->
                let
                    bars =
                        Polish.buildBars (Just [ 1, 2, 3 ]) 5
                in
                Expect.all
                    [ \_ -> Expect.equal 24 (List.length bars)
                    , \_ -> Expect.equal True (List.all (\b -> b.count == 0 && b.heat == 0 && not b.active) bars)
                    , \_ -> Expect.equal [ 5 ] (List.map .hour (List.filter .isNow bars))
                    , \_ -> Expect.equal 24 (List.length (Polish.buildBars Nothing 0))
                    ]
                    ()
        , test "scales each bar against the busiest hour" <|
            \_ ->
                let
                    hours =
                        List.indexedMap
                            (\h _ ->
                                case h of
                                    3 ->
                                        4.8

                                    5 ->
                                        16

                                    7 ->
                                        -8

                                    8 ->
                                        0 / 0

                                    _ ->
                                        0
                            )
                            (List.repeat 24 0)

                    bars =
                        Polish.buildBars (Just hours) 5

                    at h =
                        List.head (List.drop h bars)
                            |> Maybe.map (\b -> ( b.count, b.heat, ( b.active, b.isNow ) ))
                in
                Expect.all
                    [ \_ -> Expect.equal (Just ( 4, 0.25, ( True, False ) )) (at 3)
                    , \_ -> Expect.equal (Just ( 16, 1, ( True, True ) )) (at 5)
                    , \_ -> Expect.equal (Just ( 0, 0, ( False, False ) )) (at 7)
                    , \_ -> Expect.equal (Just ( 0, 0, ( False, False ) )) (at 8)
                    ]
                    ()
        , test "does not mark a current hour when the input hour is invalid" <|
            \_ ->
                Polish.buildBars (Just (List.repeat 24 1)) 24
                    |> List.any .isNow
                    |> Expect.equal False
        , test "builds a canonical app deep link for a room moment" <|
            \_ ->
                Invite.buildMomentLink "https://chat.example" "#general" (utc "2026-06-30" "12:00")
                    |> Expect.equal (Just "https://chat.example/app/?join=%23general&at=2026-06-30T12%3A00%3A00.000Z")
        , test "bar labels and status copy" <|
            \_ ->
                let
                    s =
                        Polish.blankScrubber
                in
                Expect.all
                    [ \_ ->
                        Expect.equal "Jump to 2026-07-17 00:00 UTC, 0 messages"
                            (Polish.barLabel { hour = 0, count = 0, heat = 0, active = False, isNow = True } "2026-07-17")
                    , \_ ->
                        Expect.equal "Jump to 2026-07-17 05:00 UTC, 1 message"
                            (Polish.barLabel { hour = 5, count = 1, heat = 1, active = True, isNow = False } "2026-07-17")
                    , \_ -> Expect.equal "loading" (Polish.scrubberStatus String.fromInt { s | loading = True })
                    , \_ -> Expect.equal "no stats yet" (Polish.scrubberStatus String.fromInt s)
                    , \_ -> Expect.equal "quiet" (Polish.scrubberStatus String.fromInt { s | pulse = Just { hours = [], total = 0 } })
                    , \_ -> Expect.equal "9 msgs" (Polish.scrubberStatus String.fromInt { s | pulse = Just { hours = [], total = 9 } })
                    ]
                    ()
        ]


scrubberBehavior : Test
scrubberBehavior =
    let
        now =
            utc "2026-07-16" "23:59" + 30000

        room =
            inRoom { blank | nowMs = now, origin = "https://chat.example" }

        ( opened, openOut ) =
            update (pm Polish.ScrubberOpen) { room | roomMenuOpen = True }

        loaded =
            after
                (HttpResult
                    { key = "scrubber-pulse-root"
                    , ok = True
                    , status = 200
                    , body = pulseBody (List.indexedMap (\h _ -> if h == 5 then 9 else 0) (List.repeat 24 0)) 9
                    }
                )
                opened
    in
    describe "TimeScrubber"
        [ test "opening from the room menu fetches the pulse and keeps the shell (loading state)" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal True opened.polish.scrubber.open
                    , \_ -> Expect.equal False opened.roomMenuOpen
                    , \_ -> Expect.equal [ HttpFetch { key = "scrubber-pulse-root", url = "/stats/data/root.json" } ] openOut
                    , \_ -> Expect.equal "2026-07-16" opened.polish.scrubber.date
                    , \_ -> query opened |> Query.find [ testid "time-scrubber" ] |> Query.has [ Selector.text "loading" ]
                    , \_ -> query opened |> Query.has [ testid "room-header" ]
                    ]
                    ()
        , test "labels the channel scrubber, hourly buttons, date jump, and copy action" <|
            \_ ->
                let
                    q =
                        query loaded
                in
                Expect.all
                    [ \_ -> q |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Time scrubber for #root") ]
                    , \_ -> q |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Activity by UTC hour for #root") ]
                    , \_ -> q |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Jump to 2026-07-16 05:00 UTC, 9 messages") ]
                    , \_ -> q |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Jump to date at 12:00 UTC") ]
                    , \_ -> q |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Copy moment link for #root") ]
                    , \_ ->
                        q
                            |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Room ledger for #root"), Selector.class "time-scrubber__ledger" ]
                            |> Query.has [ Selector.attribute (Attr.href "/stats/?room=%23root") ]
                    , \_ -> q |> Query.find [ testid "time-scrubber" ] |> Query.has [ Selector.text "9 msgs" ]
                    ]
                    ()
        , test "rolls the untouched UTC date forward and jumps the current-hour bar to the new day" <|
            \_ ->
                let
                    rolled =
                        tick (now + 60000) loaded

                    jumped =
                        after (pm (Polish.ScrubberHour 0)) rolled

                    midnight =
                        query rolled
                            |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Jump to 2026-07-17 00:00 UTC, 0 messages") ]
                in
                Expect.all
                    [ \_ -> Expect.equal "2026-07-17" rolled.polish.scrubber.date
                    , \_ -> midnight |> Query.has [ Selector.class "time-scrubber__bar--now" ]
                    , \_ -> midnight |> Event.simulate Event.click |> Event.expect (pm (Polish.ScrubberHour 0))
                    , \_ -> Expect.equal (Just { target = "#root", at = utc "2026-07-17" "00:00" }) jumped.pendingTravel
                    ]
                    ()
        , test "preserves an explicit historical date across UTC midnight" <|
            \_ ->
                let
                    picked =
                        after (pm (Polish.ScrubberDate "2026-06-30")) loaded

                    rolled =
                        tick (now + 60000) picked
                in
                Expect.all
                    [ \_ -> Expect.equal (Just { target = "#root", at = utc "2026-06-30" "12:00" }) picked.pendingTravel
                    , \_ -> Expect.equal "2026-06-30" rolled.polish.scrubber.date
                    , \_ ->
                        query rolled
                            |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Jump to 2026-06-30 00:00 UTC, 0 messages") ]
                            |> Query.has [ Selector.class "time-scrubber__bar--now" ]
                    ]
                    ()
        , test "copies the selected moment and retires stale clipboard feedback" <|
            \_ ->
                let
                    ( copying, copyOut ) =
                        update (pm Polish.ScrubberCopy) loaded

                    copied =
                        after (ClipboardResult { tag = "scrubber-moment", ok = True }) copying

                    stale =
                        copying
                            |> after (pm (Polish.ScrubberHour 3))
                            |> after (ClipboardResult { tag = "scrubber-moment", ok = True })

                    failed =
                        after (ClipboardResult { tag = "scrubber-moment", ok = False }) copying
                in
                Expect.all
                    [ \_ ->
                        Expect.equal
                            [ ClipboardCopy { text = "https://chat.example/app/?join=%23root&at=2026-07-16T23%3A59%3A30.000Z", tag = "scrubber-moment" } ]
                            copyOut
                    , \_ -> query copied |> Query.find [ Selector.class "time-scrubber__copy" ] |> Query.has [ Selector.text "Copied" ]
                    , \_ -> query copied |> Query.has [ Selector.text "Moment link copied for #root" ]
                    , \_ -> Expect.equal Polish.CopyIdle stale.polish.scrubber.copy
                    , \_ -> query failed |> Query.find [ Selector.class "time-scrubber__copy" ] |> Query.has [ Selector.text "Copy failed" ]
                    , \_ -> Expect.equal Polish.CopyIdle (tick (now + 2000) copied).polish.scrubber.copy
                    ]
                    ()
        , test "hour bars rove with arrows, Home and End (one tab stop)" <|
            \_ ->
                let
                    ( roved, out ) =
                        update (pm (Polish.ScrubberRove 24)) loaded

                    tabStops =
                        query loaded
                            |> Query.findAll [ Selector.class "time-scrubber__bar", Selector.attribute (Attr.attribute "tabindex" "0") ]
                in
                Expect.all
                    [ \_ -> Expect.equal 0 roved.polish.scrubber.roving
                    , \_ -> Expect.equal [ PrefsFocus { id = "time-scrubber-hour-0" } ] out
                    , \_ -> tabStops |> Query.count (Expect.equal 1)
                    , \_ -> Expect.equal 23 (after (pm (Polish.ScrubberRove -1)) loaded).polish.scrubber.roving
                    ]
                    ()
        , test "a room change refetches and the scrubber is room-only; Escape closes it" <|
            \_ ->
                let
                    ( moved, out ) =
                        update (ChannelSelect "#other") loaded

                    dm =
                        { loaded | activeChannel = Just "alice" }
                in
                Expect.all
                    [ \_ -> Expect.equal True (List.member (HttpFetch { key = "scrubber-pulse-other", url = "/stats/data/other.json" }) out)
                    , \_ -> Expect.equal Nothing moved.polish.scrubber.pulse
                    , \_ -> query dm |> Query.hasNot [ testid "time-scrubber" ]
                    , \_ -> Expect.equal (Just (pm Polish.ScrubberClose)) (escapeMsg loaded)
                    ]
                    ()
        , test "the room More menu offers the scrubber for rooms" <|
            \_ ->
                query (inRoom { blank | roomMenuOpen = True })
                    |> Query.find [ testid "room-time-scrubber" ]
                    |> Event.simulate Event.click
                    |> Event.expect (pm Polish.ScrubberOpen)
        ]



-- COMPOSER MORE TOOLS


toolsTray : Test
toolsTray =
    let
        ready =
            inRoom { blank | composer = "later" }

        open =
            after (pm Polish.ToolsToggle) ready
    in
    describe "composer More tools"
        [ test "the trigger toggles a labelled non-modal tray and closes emoji / schedule" <|
            \_ ->
                let
                    busy =
                        { ready | scheduleOpen = True }
                            |> after ComposerEmojiToggle

                    opened =
                        after (pm Polish.ToolsToggle) busy

                    tray =
                        query open |> Query.find [ testid "composer-tools-tray" ]
                in
                Expect.all
                    [ \_ -> Expect.equal True opened.polish.toolsOpen
                    , \_ -> Expect.equal False opened.scheduleOpen
                    , \_ -> Expect.equal False opened.composerAssist.emojiOpen
                    , \_ -> tray |> Query.has [ Selector.attribute (Attr.attribute "role" "dialog"), Selector.attribute (Attr.attribute "aria-modal" "false"), Selector.attribute (Attr.attribute "aria-label" "More composer tools") ]
                    , \_ -> tray |> Query.has [ Selector.text "Attach", Selector.text "Send later", Selector.text "Jump to date", Selector.text "Emoji", Selector.text "Insert /" ]
                    , \_ -> query open |> Query.find [ testid "composer-more-tools" ] |> Query.has [ Selector.attribute (Attr.attribute "aria-expanded" "true"), Selector.attribute (Attr.attribute "aria-controls" "shell-composer-tools") ]
                    , \_ -> Expect.equal False (after (pm Polish.ToolsToggle) open).polish.toolsOpen
                    , \_ -> Expect.equal False (after (pm Polish.ToolsToggle) blank).polish.toolsOpen
                    ]
                    ()
        , test "Send later opens the existing schedule popover; refused without a draft" <|
            \_ ->
                let
                    scheduled =
                        after (pm Polish.ToolsSchedule) open

                    empty =
                        after (pm Polish.ToolsSchedule) { open | composer = "" }
                in
                Expect.all
                    [ \_ -> Expect.equal ( True, False ) ( scheduled.scheduleOpen, scheduled.polish.toolsOpen )
                    , \_ -> Expect.equal False empty.scheduleOpen
                    , \_ -> query scheduled |> Query.has [ Selector.class "onyx-schedule-pop" ]
                    ]
                    ()
        , test "Jump to date, Attach, Emoji and the slash tip route to the existing folds" <|
            \_ ->
                let
                    ( slashed, slashOut ) =
                        update (pm Polish.ToolsSlash) { open | composer = "" }
                in
                Expect.all
                    [ \_ -> Expect.equal True (after (pm Polish.ToolsJump) open).showJumpToDate
                    , \_ -> Expect.equal True (after (pm Polish.ToolsEmoji) open).composerAssist.emojiOpen
                    , \_ -> Expect.equal False (after (pm Polish.ToolsAttach) open).polish.toolsOpen
                    , \_ -> Expect.equal "/" slashed.composer
                    , \_ -> Expect.equal True (List.member (PrefsFocus { id = "shell-composer-input" }) slashOut)
                    , \_ -> Expect.equal False slashed.polish.toolsOpen
                    ]
                    ()
        , test "Escape closes the tray and returns focus to the trigger" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (Just (pm Polish.ToolsClose)) (escapeMsg open)
                    , \_ -> Expect.equal [ PrefsFocus { id = "shell-composer-more" } ] (outs (pm Polish.ToolsClose) open)
                    ]
                    ()
        , test "a send closes the emoji picker and the tray (known gap)" <|
            \_ ->
                let
                    picking =
                        after ComposerEmojiToggle (inRoom { blank | composer = "hi" })

                    sent =
                        after ComposerSend picking
                in
                Expect.all
                    [ \_ -> Expect.equal True picking.composerAssist.emojiOpen
                    , \_ -> Expect.equal "" sent.composer
                    , \_ -> Expect.equal False sent.composerAssist.emojiOpen
                    , \_ -> Expect.equal False (after ComposerSend { open | composer = "hey" }).polish.toolsOpen
                    ]
                    ()
        ]



-- FIRST-RUN NOTIFY


firstRunNotify : Test
firstRunNotify =
    let
        ( sentOnce, sendOut ) =
            update ComposerSend (inRoom { fresh | composer = "hello" })
    in
    describe "FirstRunNotifyPrompt"
        [ test "stays quiet on first paint — inbound history is not a send" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal False (firstRunNotifyOffered fresh)
                    , \_ -> query fresh |> Query.hasNot [ testid "first-run-notify" ]
                    ]
                    ()
        , test "asks once after the first send and dismissed stays dismissed" <|
            \_ ->
                let
                    sheet =
                        query sentOnce |> Query.find [ testid "first-run-notify" ]

                    ( dismissed, dismissOut ) =
                        update (pm Polish.NotifyDismiss) sentOnce

                    sentAgain =
                        after ComposerSend { dismissed | composer = "again" }
                in
                Expect.all
                    [ \_ -> Expect.equal True (hasFlagSave Polish.notifyFirstSendKey sendOut)
                    , \_ -> Expect.equal True (firstRunNotifyOffered sentOnce)
                    , \_ -> sheet |> Query.has [ Selector.text Polish.firstRunNotifyTitle, Selector.text Polish.firstRunNotifyLede ]
                    , \_ -> sheet |> Query.find [ testid "first-run-notify-dismiss" ] |> Event.simulate Event.click |> Event.expect (pm Polish.NotifyDismiss)
                    , \_ -> Expect.equal True (hasFlagSave Polish.notifyDismissKey dismissOut)
                    , \_ -> Expect.equal False (firstRunNotifyOffered sentAgain)
                    , \_ -> query sentAgain |> Query.hasNot [ testid "first-run-notify" ]
                    , \_ -> Expect.equal (Just (pm Polish.NotifyDismiss)) (escapeMsg sentOnce)
                    ]
                    ()
        , test "a slash command is not a first send" <|
            \_ ->
                Expect.equal False (Polish.isRealSend "/join #x")
        , test "arms browser alerts from the quiet sheet" <|
            \_ ->
                let
                    ( busy, out ) =
                        update (pm Polish.NotifyEnable) sentOnce

                    answered =
                        after (NotifyPermissionChanged "granted") busy
                in
                Expect.all
                    [ \_ -> Expect.equal [ NotifyPermissionRequest ] out
                    , \_ -> Expect.equal [] (outs (pm Polish.NotifyEnable) busy)
                    , \_ -> Expect.equal False (firstRunNotifyOffered answered)
                    , \_ -> Expect.equal True answered.polish.notifyDismissed
                    , \_ -> Expect.equal (Just "Notifications allowed") (List.head answered.toasts |> Maybe.map .title)
                    ]
                    ()
        , test "iOS Safari tab does not claim push after a send" <|
            \_ ->
                let
                    tab =
                        withPolish (\p -> { p | navigatorStandalone = Just False }) sentOnce
                in
                Expect.all
                    [ \_ -> Expect.equal False (firstRunNotifyOffered tab)
                    , \_ -> Expect.equal [] (outs (pm Polish.NotifyEnable) tab)
                    , \_ -> Expect.equal Nothing (Polish.firstRunNotifyCopy (Just False))
                    ]
                    ()
        , test "may offer on an iOS Home Screen standalone web app after a send" <|
            \_ ->
                withPolish (\p -> { p | navigatorStandalone = Just True, surface = Polish.PwaSurface }) sentOnce
                    |> firstRunNotifyOffered
                    |> Expect.equal True
        , test "does not ask on the Zig host when native notifications are false" <|
            \_ ->
                Polish.shouldOfferFirstRunNotify
                    { sent = True
                    , dismissed = False
                    , permission = Notify.Default
                    , surface = Polish.ZigDesktopSurface
                    , hostNotifications = False
                    , navigatorStandalone = Nothing
                    }
                    |> Expect.equal False
        , test "does not nag when permission is already granted or denied, or the sheet is open" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal False (firstRunNotifyOffered { sentOnce | notifyPermission = Notify.Granted })
                    , \_ -> Expect.equal False (firstRunNotifyOffered { sentOnce | notifyPermission = Notify.Denied })
                    , \_ -> Expect.equal False (firstRunNotifyOffered { sentOnce | notifySheetOpen = True })
                    ]
                    ()
        ]



-- FIRST HOUR


firstHour : Test
firstHour =
    describe "first-hour coach persistence (onyx:first-hour-seen)"
        [ test "dismissing persists once" <|
            \_ ->
                let
                    ( dismissed, out ) =
                        update HomeCoachDismiss fresh
                in
                Expect.all
                    [ \_ -> Expect.equal [ PolishFlagSave { key = "onyx:first-hour-seen" } ] out
                    , \_ -> Expect.equal True dismissed.homeCoachDismissed
                    , \_ -> Expect.equal [] (outs HomeCoachDismiss dismissed)
                    ]
                    ()
        , test "a first send marks the hour seen" <|
            \_ ->
                let
                    ( sent, out ) =
                        update ComposerSend (inRoom { fresh | composer = "hi" })
                in
                Expect.all
                    [ \_ -> Expect.equal True sent.homeCoachDismissed
                    , \_ -> Expect.equal True (hasFlagSave Polish.firstHourSeenKey out)
                    ]
                    ()
        , test "the persisted flag restores at boot" <|
            \_ ->
                let
                    flags =
                        Just (Encode.object [ ( "firstHourSeen", Encode.bool True ), ( "notifyDismissed", Encode.bool True ) ])
                in
                Expect.all
                    [ \_ -> Expect.equal True (Polish.firstHourSeenFromFlags flags)
                    , \_ -> Expect.equal True (Polish.fromFlags flags).firstHourPersisted
                    , \_ -> Expect.equal True (Polish.fromFlags flags).notifyDismissed
                    , \_ -> Expect.equal False (Polish.firstHourSeenFromFlags Nothing)
                    , \_ -> Expect.equal Polish.initial (Polish.fromFlags Nothing)
                    ]
                    ()
        ]



-- ADD TO HOME SCREEN


addToHomeScreen : Test
addToHomeScreen =
    let
        quiet =
            withPolish (\p -> { p | notifyDismissed = True }) fresh

        a2 f model =
            withPolish (\p -> { p | a2hs = f p.a2hs }) model

        chromium =
            quiet
                |> a2 (\a -> { a | platform = Polish.Chromium, sent = True })
                |> after (pm (Polish.PwaEventReceived (Encode.object [ ( "kind", Encode.string "install-available" ) ])))

        ios =
            a2 (\a -> { a | platform = Polish.Ios, sent = True }) quiet
    in
    describe "AddToHomeScreenSheet"
        [ test "shows no install UI on first paint" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal False (a2hsOffered quiet)
                    , \_ -> query quiet |> Query.hasNot [ testid "a2hs-sheet" ]
                    ]
                    ()
        , test "can offer Chromium Add to Home Screen after a sent message and a captured prompt" <|
            \_ ->
                let
                    sheet =
                        query chromium |> Query.find [ testid "a2hs-sheet" ]
                in
                Expect.all
                    [ \_ -> sheet |> Query.has [ Selector.text Polish.a2hsTitle, Selector.text Polish.a2hsChromiumLede ]
                    , \_ -> sheet |> Query.find [ testid "a2hs-add" ] |> Query.has [ Selector.text "Add to Home Screen" ]
                    , \_ -> sheet |> Query.hasNot [ Selector.text "Install the app" ]
                    , \_ -> Expect.equal [ PwaInstallPrompt ] (outs (pm Polish.A2hsAdd) chromium)
                    ]
                    ()
        , test "iOS gets Share copy, never a fake install button" <|
            \_ ->
                let
                    sheet =
                        query ios |> Query.find [ testid "a2hs-sheet" ]
                in
                Expect.all
                    [ \_ -> sheet |> Query.has [ Selector.text Polish.a2hsIosLede, Selector.text Polish.a2hsIosPush ]
                    , \_ -> sheet |> Query.hasNot [ testid "a2hs-add" ]
                    ]
                    ()
        , test "a returning visit with a joined room counts; standalone and PWA never ask" <|
            \_ ->
                let
                    returning =
                        a2 (\a -> { a | platform = Polish.Ios, returning = True }) quiet
                in
                Expect.all
                    [ \_ -> Expect.equal False (a2hsOffered returning)
                    , \_ -> Expect.equal False (a2hsOffered (a2 (\a -> { a | standalone = True }) ios))
                    , \_ -> Expect.equal False (a2hsOffered (withPolish (\p -> { p | surface = Polish.PwaSurface }) ios))
                    , \_ -> Expect.equal True (Polish.hasHomeScreenEngagement { sent = False, returning = True, joinedRoom = True })
                    , \_ -> Expect.equal False (Polish.hasHomeScreenEngagement { sent = False, returning = True, joinedRoom = False })
                    ]
                    ()
        , test "dismissal persists; the outcome dismisses and reports" <|
            \_ ->
                let
                    ( dismissed, out ) =
                        update (pm Polish.A2hsDismiss) chromium

                    accepted =
                        chromium
                            |> after (pm Polish.A2hsAdd)
                            |> after (pm (Polish.PwaEventReceived (Encode.object [ ( "kind", Encode.string "install-outcome" ), ( "outcome", Encode.string "accepted" ) ])))
                in
                Expect.all
                    [ \_ -> Expect.equal [ PolishFlagSave { key = "onyx:a2hs-dismissed" } ] out
                    , \_ -> Expect.equal False (a2hsOffered dismissed)
                    , \_ -> Expect.equal False (a2hsOffered accepted)
                    , \_ -> Expect.equal (Just (Just "Onyx was added to your Home Screen.")) (List.head accepted.toasts |> Maybe.map .description)
                    ]
                    ()
        , test "waits while the notifications ask is up" <|
            \_ ->
                let
                    both =
                        withPolish (\p -> { p | notifyDismissed = False, notifyFirstSend = True }) chromium
                in
                Expect.all
                    [ \_ -> Expect.equal True (firstRunNotifyOffered both)
                    , \_ -> Expect.equal False (a2hsOffered both)
                    ]
                    ()
        , test "platform detection words" <|
            \_ ->
                Expect.equal [ Polish.Ios, Polish.Chromium, Polish.OtherPlatform ]
                    (List.map Polish.parsePlatform [ "ios", "chromium", "firefox" ])
        ]



-- UPDATE AVAILABLE


updateAvailable : Test
updateAvailable =
    let
        available =
            after (pm (Polish.PwaEventReceived (Encode.object [ ( "kind", Encode.string "update-available" ) ]))) blank

        calls =
            available.calls

        inCall =
            { available | calls = { calls | lifecycle = Media.InCall } }
    in
    describe "UpdateAvailable"
        [ test "nothing shows without a service-worker update" <|
            \_ -> query blank |> Query.hasNot [ testid "update-available" ]
        , test "exposes a named, described button and delegates approval" <|
            \_ ->
                let
                    button =
                        query available |> Query.find [ testid "update-available" ] |> Query.find [ Selector.tag "button" ]
                in
                Expect.all
                    [ \_ -> query available |> Query.find [ testid "update-available" ] |> Query.has [ Selector.attribute (Attr.attribute "role" "status"), Selector.text "An Onyx update is ready. Reload when you are ready." ]
                    , \_ -> button |> Query.has [ Selector.text "Reload to update", Selector.attribute (Attr.attribute "aria-describedby" "update-available-message") ]
                    , \_ -> button |> Event.simulate Event.click |> Event.expect (pm Polish.UpdateApprove)
                    , \_ -> Expect.equal [ PwaUpdateApprove ] (outs (pm Polish.UpdateApprove) available)
                    ]
                    ()
        , test "uses deferred copy while a call is up and reloads once it ends" <|
            \_ ->
                let
                    ( approved, out ) =
                        update (pm Polish.UpdateApprove) inCall

                    hungUp =
                        { approved | calls = { calls | lifecycle = Media.Idle } }
                in
                Expect.all
                    [ \_ -> query inCall |> Query.find [ testid "update-available" ] |> Query.has [ Selector.text "Reload when safe" ]
                    , \_ -> Expect.equal [] out
                    , \_ -> Expect.equal True (List.member PwaUpdateApprove (outs settleNoop hungUp))
                    ]
                    ()
        ]


{-| Any message runs the post-update settle. -}
settleNoop : Msg
settleNoop =
    PrefsFocusDone



-- BACK ONLINE


backOnline : Test
backOnline =
    let
        firstDial =
            { fresh | connection = Offline, nowMs = 5000 }

        ( firstLive, _ ) =
            update (WsLineReceived ":irc.example 001 me :welcome") firstDial

        dropped =
            { firstLive | connection = Offline, nowMs = 9000 }

        ( recovered, _ ) =
            update (WsLineReceived ":irc.example 001 me :welcome back") dropped
    in
    describe "reconnect banner: Back online only after a recovery"
        [ test "the very first connect never says Back online" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal Live firstLive.connection
                    , \_ -> Expect.equal 0 firstLive.backOnlineAt
                    , \_ -> Expect.equal Nothing (reconnectBanner { firstLive | nowMs = 5500 })
                    , \_ -> Expect.equal True firstLive.polish.hasBeenLive
                    ]
                    ()
        , test "a 001 after a drop is a recovery" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal 9000 recovered.backOnlineAt
                    , \_ -> Expect.equal (Just { title = "Back online", detail = "", online = True }) (reconnectBanner { recovered | nowMs = 9500 })
                    ]
                    ()
        , test "the first handshake leaves Connecting to the gate; a re-handshake shows it" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal Nothing (reconnectBanner { fresh | connection = Registering })
                    , \_ ->
                        Expect.equal (Just "Connecting…")
                            (reconnectBanner { firstLive | connection = Registering } |> Maybe.map .title)
                    ]
                    ()
        ]

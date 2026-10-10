module Polish exposing
    ( A2hs
    , A2hsOutcome(..)
    , A2hsPlatform(..)
    , Bar
    , CopyState(..)
    , blankScrubber
    , Msg(..)
    , PulseData
    , PwaEvent(..)
    , Scrubber
    , State
    , Surface(..)
    , UpdateState
    , a2hsChromiumLede
    , a2hsCopyFor
    , a2hsDismissKey
    , a2hsIosLede
    , a2hsIosPush
    , a2hsOutcomeStatus
    , a2hsSentKey
    , a2hsTitle
    , barLabel
    , buildBars
    , canClaimClosedTabPush
    , copyResetMs
    , decodePwaEvent
    , firstHourSeenFromFlags
    , firstHourSeenKey
    , firstRunNotifyCopy
    , firstRunNotifyLede
    , firstRunNotifyTitle
    , fromFlags
    , hasHomeScreenEngagement
    , initial
    , initialLive
    , isRealSend
    , notifyArmedToast
    , notifyDismissKey
    , notifyFirstSendKey
    , pad2
    , parsePlatform
    , pulseRefreshMs
    , scrubberStatus
    , shouldOfferAddToHomeScreen
    , shouldOfferFirstRunNotify
    , surfaceFor
    , updateMessage
    , utcHour
    )

{-| v3/polish — the pure core of the late-roadmap polish slice:

  - the composer **More tools** tray (`Composer.tsx` "More tools");
  - the **TimeScrubber** (`src/shell/TimeScrubber.tsx`): 24 UTC-hour
    bars over the room pulse feed, each a jump into the existing
    `requestTravelTo` machinery;
  - the **first-run notifications prompt**
    (`src/lib/notifications/firstRunNotify.ts`,
    `src/shell/FirstRunNotifyPrompt.tsx`);
  - the **Add to Home Screen** courtesy (`src/pwa/addToHomeScreen.ts`,
    `AddToHomeScreenSheet.tsx`) and the **update-available** banner
    (`src/pwa/UpdateAvailable.tsx`);
  - `hasBeenLive`, so the reconnect banner only says "Back online"
    after a real recovery (the oracle `recovering` latch).

This module never imports `App`; App owns one `polish : State` field,
one `PolishMsg Msg` wrapper and the handler that maps intents onto the
existing folds.

-}

import Json.Decode as Decode
import Notify



-- STORAGE KEYS (oracle `onyx:*` flags, "1" markers)


firstHourSeenKey : String
firstHourSeenKey =
    "onyx:first-hour-seen"


notifyFirstSendKey : String
notifyFirstSendKey =
    "onyx:notify-first-send"


notifyDismissKey : String
notifyDismissKey =
    "onyx:notify-first-run-dismissed"


a2hsDismissKey : String
a2hsDismissKey =
    "onyx:a2hs-dismissed"


a2hsSentKey : String
a2hsSentKey =
    "onyx:a2hs-message-sent"



-- STATE


type Surface
    = BrowserSurface
    | PwaSurface
    | ZigDesktopSurface


type A2hsPlatform
    = Ios
    | Chromium
    | OtherPlatform


type alias A2hs =
    { dismissed : Bool
    , sent : Bool
    , returning : Bool
    , platform : A2hsPlatform
    , standalone : Bool
    , captured : Bool
    , status : String
    }


type alias UpdateState =
    { available : Bool
    , approved : Bool
    , reloading : Bool
    }


type alias PulseData =
    { hours : List Float
    , total : Int
    }


type CopyState
    = CopyIdle
    | CopyCopied Float
    | CopyFailed


type alias Scrubber =
    { open : Bool
    , channel : String
    , date : String
    , followsToday : Bool
    , pulse : Maybe PulseData
    , loading : Bool
    , fetchedAt : Float
    , roving : Int
    , moment : Float
    , copy : CopyState
    , copyFor : Maybe ( String, Float )
    }


type alias State =
    { toolsOpen : Bool
    , hasBeenLive : Bool
    , firstHourPersisted : Bool
    , notifyFirstSend : Bool
    , notifyDismissed : Bool
    , notifyBusy : Bool
    , navigatorStandalone : Maybe Bool
    , surface : Surface
    , hostNotifications : Bool
    , serviceWorker : Bool
    , a2hs : A2hs
    , update : UpdateState
    , scrubber : Scrubber
    }


type Msg
    = ToolsToggle
    | ToolsClose
    | ToolsAttach
    | ToolsSchedule
    | ToolsJump
    | ToolsEmoji
    | ToolsSlash
    | NotifyEnable
    | NotifyDismiss
    | A2hsAdd
    | A2hsDismiss
    | PwaEventReceived Decode.Value
    | UpdateApprove
    | ScrubberOpen
    | ScrubberClose
    | ScrubberHour Int
    | ScrubberDate String
    | ScrubberRove Int
    | ScrubberCopy


blankScrubber : Scrubber
blankScrubber =
    { open = False
    , channel = ""
    , date = ""
    , followsToday = True
    , pulse = Nothing
    , loading = False
    , fetchedAt = 0
    , roving = 0
    , moment = 0
    , copy = CopyIdle
    , copyFor = Nothing
    }


{-| Fresh boot: nothing persisted, never live yet. -}
initial : State
initial =
    { toolsOpen = False
    , hasBeenLive = False
    , firstHourPersisted = False
    , notifyFirstSend = False
    , notifyDismissed = False
    , notifyBusy = False
    , navigatorStandalone = Nothing
    , surface = BrowserSurface
    , hostNotifications = False
    , serviceWorker = False
    , a2hs =
        { dismissed = False
        , sent = False
        , returning = False
        , platform = OtherPlatform
        , standalone = False
        , captured = False
        , status = ""
        }
    , update = { available = False, approved = False, reloading = False }
    , scrubber = blankScrubber
    }


{-| The seasoned fixture behind `App.blank` (already Live): it has been
live, so a later 001 after a drop is a recovery, and every quiet-ask
flag is already persisted / answered on this device, so plain sends
and renders stay free of first-run side effects.
-}
initialLive : State
initialLive =
    let
        a =
            initial.a2hs
    in
    { initial
        | hasBeenLive = True
        , firstHourPersisted = True
        , notifyFirstSend = True
        , notifyDismissed = True
        , a2hs = { a | sent = True }
    }



-- FLAGS


{-| The `polish` boot flag object (read by `index.html` through
`OnyxPorts.polishFlags`). Every field is optional; anything malformed
falls back to the fresh-boot default.
-}
fromFlags : Maybe Decode.Value -> State
fromFlags raw =
    case raw of
        Nothing ->
            initial

        Just value ->
            let
                bool key =
                    Decode.decodeValue (Decode.field key Decode.bool) value
                        |> Result.withDefault False

                standalone =
                    Decode.decodeValue (Decode.field "navigatorStandalone" Decode.bool) value
                        |> Result.toMaybe

                displayStandalone =
                    bool "standaloneDisplay"

                platform =
                    Decode.decodeValue (Decode.field "platform" Decode.string) value
                        |> Result.map parsePlatform
                        |> Result.withDefault OtherPlatform

                base =
                    initial.a2hs
            in
            { initial
                | firstHourPersisted = bool "firstHourSeen"
                , notifyFirstSend = bool "notifyFirstSend"
                , notifyDismissed = bool "notifyDismissed"
                , navigatorStandalone = standalone
                , surface = surfaceFor { standaloneDisplay = displayStandalone, navigatorStandalone = standalone }
                , serviceWorker = bool "serviceWorker"
                , a2hs =
                    { base
                        | dismissed = bool "a2hsDismissed"
                        , sent = bool "a2hsSent"
                        , returning = bool "a2hsReturning"
                        , platform = platform
                        , standalone = displayStandalone || standalone == Just True
                    }
            }


firstHourSeenFromFlags : Maybe Decode.Value -> Bool
firstHourSeenFromFlags raw =
    case raw of
        Nothing ->
            False

        Just value ->
            Decode.decodeValue (Decode.field "firstHourSeen" Decode.bool) value
                |> Result.withDefault False


parsePlatform : String -> A2hsPlatform
parsePlatform raw =
    case raw of
        "ios" ->
            Ios

        "chromium" ->
            Chromium

        _ ->
            OtherPlatform


{-| The Elm build is always a browser tab or an installed PWA (the
`zig-desktop` host bridge is not part of this build).
-}
surfaceFor : { standaloneDisplay : Bool, navigatorStandalone : Maybe Bool } -> Surface
surfaceFor probe =
    if probe.standaloneDisplay || probe.navigatorStandalone == Just True then
        PwaSurface

    else
        BrowserSurface



-- FIRST-RUN NOTIFY (firstRunNotify.ts)


firstRunNotifyTitle : String
firstRunNotifyTitle =
    "Get a ping when you leave"


firstRunNotifyLede : String
firstRunNotifyLede =
    "Mentions, DMs, and calls can reach this browser."


{-| iOS Safari tabs (`navigator.standalone === false`) cannot receive
Web Push; a Home Screen web app (true) or any other browser (missing)
can.
-}
canClaimClosedTabPush : Maybe Bool -> Bool
canClaimClosedTabPush standalone =
    standalone /= Just False


firstRunNotifyCopy : Maybe Bool -> Maybe { title : String, lede : String }
firstRunNotifyCopy standalone =
    if canClaimClosedTabPush standalone then
        Just { title = firstRunNotifyTitle, lede = firstRunNotifyLede }

    else
        Nothing


shouldOfferFirstRunNotify :
    { sent : Bool
    , dismissed : Bool
    , permission : Notify.Permission
    , surface : Surface
    , hostNotifications : Bool
    , navigatorStandalone : Maybe Bool
    }
    -> Bool
shouldOfferFirstRunNotify input =
    if not input.sent || input.dismissed then
        False

    else if not (canClaimClosedTabPush input.navigatorStandalone) then
        False

    else if input.surface == ZigDesktopSurface && not input.hostNotifications then
        False

    else
        input.permission == Notify.Default


{-| What a "Turn on" answer reads as (the `closedTabArmedToast`
desktop leg; Web Push arming stays with the Notifications sheet).
-}
notifyArmedToast : Notify.Permission -> { success : Bool, title : String, description : String }
notifyArmedToast permission =
    if permission == Notify.Granted then
        { success = True
        , title = "Notifications allowed"
        , description = "Mentions, DMs, and calls can reach this browser while Onyx is open."
        }

    else
        { success = False
        , title = "Alerts unavailable"
        , description = "Alerts could not be turned on."
        }


{-| A send that counts as "the first send" for the quiet asks: a real
message or `/me` action, never another slash command (mirroring the
composer marking only on the admitted message path).
-}
isRealSend : String -> Bool
isRealSend draft =
    let
        trimmed =
            String.trim draft
    in
    not (String.isEmpty trimmed)
        && (not (String.startsWith "/" trimmed) || String.startsWith "/me " trimmed)



-- ADD TO HOME SCREEN (addToHomeScreen.ts)


a2hsTitle : String
a2hsTitle =
    "Add Onyx to your Home Screen"


a2hsIosLede : String
a2hsIosLede =
    "Open Share, then Add to Home Screen."


a2hsIosPush : String
a2hsIosPush =
    "Notifications on iPhone work from the Home Screen web app, not from a Safari tab."


a2hsChromiumLede : String
a2hsChromiumLede =
    "Keep Onyx with your other apps. Same rooms and messages — still the browser, closer to hand."


a2hsCopyFor : A2hsPlatform -> { lede : String, detail : Maybe String }
a2hsCopyFor platform =
    if platform == Ios then
        { lede = a2hsIosLede, detail = Just a2hsIosPush }

    else
        { lede = a2hsChromiumLede, detail = Nothing }


hasHomeScreenEngagement : { sent : Bool, returning : Bool, joinedRoom : Bool } -> Bool
hasHomeScreenEngagement input =
    input.sent || (input.returning && input.joinedRoom)


shouldOfferAddToHomeScreen :
    { engaged : Bool
    , dismissed : Bool
    , standalone : Bool
    , surface : Surface
    , platform : A2hsPlatform
    , hasCapturedPrompt : Bool
    }
    -> Bool
shouldOfferAddToHomeScreen input =
    if not input.engaged || input.dismissed then
        False

    else if input.standalone || input.surface == PwaSurface || input.surface == ZigDesktopSurface then
        False

    else if input.hasCapturedPrompt then
        True

    else
        input.platform == Ios


type A2hsOutcome
    = Accepted
    | Dismissed
    | Unavailable


a2hsOutcomeStatus : A2hsOutcome -> String
a2hsOutcomeStatus outcome =
    case outcome of
        Accepted ->
            "Onyx was added to your Home Screen."

        Dismissed ->
            "No changes made. You can add Onyx later from your browser menu."

        Unavailable ->
            "Your browser could not open the install prompt. Use the browser menu to add Onyx."



-- PWA EVENTS (ports.js `wirePolish`)


type PwaEvent
    = InstallAvailable
    | InstallOutcome A2hsOutcome
    | UpdateAvailable
    | UnknownPwaEvent


decodePwaEvent : Decode.Value -> PwaEvent
decodePwaEvent value =
    case Decode.decodeValue (Decode.field "kind" Decode.string) value of
        Ok "install-available" ->
            InstallAvailable

        Ok "install-outcome" ->
            case Decode.decodeValue (Decode.field "outcome" Decode.string) value of
                Ok "accepted" ->
                    InstallOutcome Accepted

                Ok "dismissed" ->
                    InstallOutcome Dismissed

                _ ->
                    InstallOutcome Unavailable

        Ok "update-available" ->
            UpdateAvailable

        _ ->
            UnknownPwaEvent


{-| Banner copy + button (mirroring `UpdateAvailable.tsx`): deferred
while a call (the Elm build's only "current work" holder) is up.
-}
updateMessage : Bool -> { message : String, button : String }
updateMessage deferred =
    if deferred then
        { message = "Update ready. Reload is deferred until your call or other current work finishes."
        , button = "Reload when safe"
        }

    else
        { message = "An Onyx update is ready. Reload when you are ready."
        , button = "Reload to update"
        }



-- TIME SCRUBBER (TimeScrubber.tsx)


hourCount : Int
hourCount =
    24


pulseRefreshMs : Float
pulseRefreshMs =
    60000


copyResetMs : Float
copyResetMs =
    1800


type alias Bar =
    { hour : Int
    , count : Int
    , heat : Float
    , active : Bool
    , isNow : Bool
    }


{-| Exactly 24 bars. Malformed input (not 24 hours) reads all quiet;
negative or NaN counts read 0, fractional counts floor; heat scales
against the busiest hour (floor 1). An out-of-range `nowHour` marks no
bar.
-}
buildBars : Maybe (List Float) -> Int -> List Bar
buildBars hours nowHour =
    let
        valid =
            case hours of
                Just list ->
                    if List.length list == hourCount then
                        list

                    else
                        List.repeat hourCount 0

                Nothing ->
                    List.repeat hourCount 0

        counts =
            List.map
                (\raw ->
                    if isNaN raw || isInfinite raw || raw <= 0 then
                        0

                    else
                        floor raw
                )
                valid

        peak =
            max 1 (Maybe.withDefault 0 (List.maximum counts))
    in
    List.indexedMap
        (\hour count ->
            { hour = hour
            , count = count
            , heat = toFloat count / toFloat peak
            , active = count > 0
            , isNow = hour == nowHour
            }
        )
        counts


utcHour : Float -> Int
utcHour ms =
    modBy 24 (floor (ms / 3600000))


pad2 : Int -> String
pad2 n =
    String.padLeft 2 '0' (String.fromInt n)


barLabel : Bar -> String -> String
barLabel bar date =
    let
        countText =
            if bar.count == 1 then
                "1 message"

            else
                String.fromInt bar.count ++ " messages"
    in
    "Jump to " ++ date ++ " " ++ pad2 bar.hour ++ ":00 UTC, " ++ countText


{-| `loading` only before any sample; then `no stats yet`, `quiet`, or
the total.
-}
scrubberStatus : (Int -> String) -> Scrubber -> String
scrubberStatus formatCount scrubber =
    case scrubber.pulse of
        Nothing ->
            if scrubber.loading then
                "loading"

            else
                "no stats yet"

        Just data ->
            if data.total <= 0 then
                "quiet"

            else
                formatCount data.total ++ " msgs"

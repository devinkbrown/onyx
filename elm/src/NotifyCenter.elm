module NotifyCenter exposing
    ( NotifyMode(..)
    , levelOfMode
    , modeOfLevel
    , notifyOptions
    , maxIgnoreNickLength
    , validateIgnoreDraft
    , maxDndMinutes
    , parseDndMinutes
    , dndUntilFor
    , dndRemainingMinutes
    , dndStatusLine
    )

{-| Notifications settings helpers: per-room level vocabulary, ignore-draft
validation, and DND timer parsing. All pure; the `App` folds own
normalization and persistence, so this module mirrors the oracle copy
(`ChannelNotifyControl`, `IgnoredUsersControl`, `/dnd`, `/snooze`) without
duplicating it.

-}


{-| Public per-room notification mode, mirroring the oracle `NotifyMode`
(`all` is the default when unset; `mute` is the public spelling of the
stored `none` level).
-}
type NotifyMode
    = NotifyAll
    | NotifyMentions
    | NotifyMute


{-| Stored level for a public mode (`mute` persists as `none`, mirroring
oracle `modeToLevel`).
-}
levelOfMode : NotifyMode -> String
levelOfMode mode =
    case mode of
        NotifyMute ->
            "none"

        NotifyMentions ->
            "mentions"

        NotifyAll ->
            "all"


{-| Public mode for a stored level (`none` reads as `mute`, mirroring
oracle `levelToMode`; anything else falls back to `all`).
-}
modeOfLevel : String -> NotifyMode
modeOfLevel level =
    case level of
        "none" ->
            NotifyMute

        "mentions" ->
            NotifyMentions

        _ ->
            NotifyAll


{-| Ordered room-level options, mirroring `CHANNEL_NOTIFY_OPTIONS`
(order is load-bearing for the segmented control).
-}
notifyOptions : List { mode : NotifyMode, label : String, title : String }
notifyOptions =
    [ { mode = NotifyAll, label = "All", title = "All messages" }
    , { mode = NotifyMentions, label = "@", title = "Mentions only — still badges @" }
    , { mode = NotifyMute, label = "Mute", title = "Mute — you will not be tapped" }
    ]


{-| Ignore-draft bound, mirroring oracle `MAX_IGNORED_NICK_LENGTH`. -}
maxIgnoreNickLength : Int
maxIgnoreNickLength =
    128


{-| Validate an ignore-list draft, mirroring `IgnoredUsersControl.addNick`
(trim, length, control-character, and self guards; copy kept byte-identical
where it does not name the nick). Returns the lowercase nick on success.
-}
validateIgnoreDraft : String -> String -> Result String String
validateIgnoreDraft ourNick draft =
    let
        nick =
            String.trim draft
    in
    if String.isEmpty nick then
        Err "Enter a name to block on this device."

    else if String.length nick > maxIgnoreNickLength then
        Err ("Name is too long (max " ++ String.fromInt maxIgnoreNickLength ++ " characters).")

    else if String.any (\c -> Char.toCode c <= 0x1F || Char.toCode c == 0x7F) nick then
        Err "That name contains unsupported characters. Try typing it again."

    else if String.toLower nick == String.toLower (String.trim ourNick) && not (String.isEmpty (String.trim ourNick)) then
        Err "You cannot block yourself."

    else
        Ok (String.toLower nick)


{-| DND timer ceiling in minutes, mirroring the `/dnd` + `/snooze` folds. -}
maxDndMinutes : Int
maxDndMinutes =
    1440


{-| Parse a DND-minutes draft, mirroring the `runSlashDnd` numeric arm
(floored whole minutes, 1–1440). -}
parseDndMinutes : String -> Result String Int
parseDndMinutes draft =
    case String.toFloat (String.trim draft) of
        Nothing ->
            Err "Use minutes (1–1440)."

        Just mins ->
            if isNaN mins || isInfinite mins || mins <= 0 || mins > toFloat maxDndMinutes then
                Err "Use minutes (1–1440)."

            else
                Ok (floor mins)


{-| Absolute `dndUntil` stamp for a minutes timer, mirroring the fold
(`floor nowMs + whole * 60000`). -}
dndUntilFor : Float -> Int -> Int
dndUntilFor nowMs whole =
    floor nowMs + whole * 60000


{-| Whole minutes left on a timer, or nothing when expired/absent. -}
dndRemainingMinutes : Maybe Int -> Float -> Maybe Int
dndRemainingMinutes until nowMs =
    case until of
        Nothing ->
            Nothing

        Just deadline ->
            let
                left =
                    ceiling (toFloat deadline - nowMs) // 60000
            in
            if toFloat deadline <= nowMs then
                Nothing

            else
                Just (max 1 left)


{-| One-line DND status for the settings sheet. -}
dndStatusLine : Bool -> Maybe Int -> Float -> String
dndStatusLine enabled until nowMs =
    if enabled then
        "Do not disturb is on. Turn it off to resume alerts."

    else
        case dndRemainingMinutes until nowMs of
            Just mins ->
                "Snoozed for " ++ String.fromInt mins ++ " more minute" ++ (if mins == 1 then "" else "s") ++ "."

            Nothing ->
                "Do not disturb is off."

module GapShell exposing
    ( ActivityFilter(..)
    , ConnectFailure(..)
    , Entry
    , EntryKind(..)
    , Model
    , Msg(..)
    , ShellEvent
    , activityRows
    , classifyEntry
    , classifySasl
    , closeReason
    , decodeShellEvent
    , displayLine
    , failureCopy
    , init
    , isFatalClose
    , isRetryableNickError
    , maxActivityEntries
    , maxNickRetries
    , motdHideMs
    , motdVisible
    , newLogEntries
    , normalizeJoinName
    , recordEntries
    , retryNick
    , takeWelcomeLine
    , unseenProblems
    )

{-| v3/gap-shell — state and pure rules for the shell gaps this slice
closes (see `elm/design/CLIENT_PARITY_MAP.md`, Shell and navigation +
Account and security item 1):

  - **Sign-in failures** say what happened. A refused password, a
    registered name, a taken name (after `nick_` retries) or a server
    `ERROR` each map to one `ConnectFailure`, whose copy the connect
    gate shows instead of "Couldn't reach Onyx".
  - **Activity** — every line the client only kept in `serviceLog`
    (server NOTICEs, MOTD, WALLOPS, ERROR reasons, unhandled numerics,
    unknown standard replies) gets a timestamp and a kind here, and a
    sheet renders it (`View.GapShell`).
  - **Connection lifecycle** — browser offline/online and page restore.
  - **Room actions** — leave with a confirm step, join by name.

`App` owns the wiring (one model field, one wrapper `Msg`, one settle
step); everything that does not need the whole `App.Model` lives here
so it can be tested without it.

-}

import Json.Decode as Decode



-- MODEL


type alias Model =
    { activity : List Entry
    , activityOpen : Bool
    , activityFilter : ActivityFilter
    , activitySeenAt : Float
    , connectFailure : Maybe ConnectFailure
    , nickRetries : Int
    , nickRetryBase : Maybe String
    , redialOnClose : Bool
    , redialing : Bool
    , everLive : Bool
    , liveSinceMs : Float
    , halt : Maybe String
    , closeReason : Maybe String
    , killed : Bool
    , browserOffline : Bool
    , leaveAsk : Maybe String
    , focusJoins : List String
    , joinName : String
    , joinError : Maybe String
    , motdDismissedAt : Float
    , motdExpanded : Bool
    , welcomePack : List String
    }


init : Model
init =
    { activity = []
    , activityOpen = False
    , activityFilter = ActivityAll
    , activitySeenAt = 0
    , connectFailure = Nothing
    , nickRetries = 0
    , nickRetryBase = Nothing
    , redialOnClose = False
    , redialing = False
    , everLive = False
    , liveSinceMs = 0
    , halt = Nothing
    , closeReason = Nothing
    , killed = False
    , browserOffline = False
    , leaveAsk = Nothing
    , focusJoins = []
    , joinName = ""
    , joinError = Nothing
    , motdDismissedAt = 0
    , motdExpanded = False
    , welcomePack = []
    }


type Msg
    = ActivityOpen
    | ActivityClose
    | ActivityFilterSet ActivityFilter
    | LeaveAsk String
    | LeaveCancel
    | LeaveConfirm
    | MarkRead String
    | ExportTranscript String
    | JoinNameInput String
    | JoinNameSubmit
    | MotdDismiss
    | MotdToggle
    | ShellEventReceived Decode.Value


type ActivityFilter
    = ActivityAll
    | ActivityProblems



-- ACTIVITY


type EntryKind
    = Problem
    | Connection
    | Notice


type alias Entry =
    { atMs : Float
    , text : String
    , kind : EntryKind
    }


maxActivityEntries : Int
maxActivityEntries =
    500


{-| The lines `after` gained over `prior` (both newest-first and only
ever grown by prepending, capped at `cap`). Uncapped growth is the
length difference; once the cap trims the tail, the smallest prefix
whose removal leaves a prefix of `prior` is the new part. A log that
changed some other way yields nothing rather than guessing.
-}
newLogEntries : Int -> List String -> List String -> List String
newLogEntries cap prior after =
    let
        la =
            List.length after

        lp =
            List.length prior

        search k =
            if k > la then
                []

            else if List.drop k after == List.take (la - k) prior then
                List.take k after

            else
                search (k + 1)
    in
    if after == prior then
        []

    else if la < cap && la >= lp then
        List.take (la - lp) after

    else
        search (max 1 (la - lp))


{-| Stamp new log lines (newest-first) onto the activity list. -}
recordEntries : Float -> List String -> List Entry -> List Entry
recordEntries now fresh existing =
    List.take maxActivityEntries
        (List.filterMap
            (\line ->
                Maybe.map (\text -> { atMs = now, text = text, kind = classifyEntry text }) (displayLine line)
            )
            fresh
            ++ existing
        )


{-| What a log line shows as in Activity: MOTD lines lose their `- `
margin (a bare `-` is a blank line, dropped), and the "End of /WHO
list." style closers carry nothing a person needs. -}
displayLine : String -> Maybe String
displayLine line =
    let
        trimmed =
            String.trim line

        text =
            if String.startsWith "- " trimmed then
                String.trim (String.dropLeft 2 trimmed)

            else
                trimmed
    in
    if String.isEmpty text || text == "-" || String.contains "End of /" text then
        Nothing

    else
        Just text


{-| Kind of a log line, read from the prefixes the folds write. -}
classifyEntry : String -> EntryKind
classifyEntry line =
    let
        lower =
            String.toLower line

        startsAny =
            List.any (\p -> String.startsWith p lower)
    in
    if startsAny [ "disconnected", "server error", "removed from onyx", "connection " ] then
        Connection

    else if
        startsAny [ "sign-in", "that nickname is registered", "message not delivered", "encryption unavailable", "peer key changed" ]
            || String.contains " failed" lower
            || String.contains "error" lower
            || String.contains "denied" lower
            || String.contains "not allowed" lower
            || String.contains "cannot " lower
    then
        Problem

    else
        Notice


activityRows : ActivityFilter -> List Entry -> List Entry
activityRows filter entries =
    case filter of
        ActivityAll ->
            entries

        ActivityProblems ->
            List.filter (\e -> e.kind /= Notice) entries


{-| Problems and connection events newer than the last look. -}
unseenProblems : Model -> Int
unseenProblems model =
    List.length (List.filter (\e -> e.kind /= Notice && e.atMs > model.activitySeenAt) model.activity)



-- SIGN-IN FAILURES


type ConnectFailure
    = FailPassword
    | FailTwoStep
    | FailSaslTimeout
    | FailNoMechanism
    | FailSignIn String
    | FailRegisteredNick String
    | FailNickTaken String
    | FailNickRefused String String
    | FailServer String


{-| Map a SASL failure reason (the 904 text, or the ports-side reason)
to what the person needs to know. The server's texts are
`SASL authentication failed`, `Unsupported SASL mechanism`,
`Two-factor authentication required: …` and
`Account storage requires recovery`.
-}
classifySasl : String -> ConnectFailure
classifySasl reason =
    let
        lower =
            String.toLower reason
    in
    if String.contains "two-factor" lower then
        FailTwoStep

    else if String.contains "timed out" lower then
        FailSaslTimeout

    else if String.contains "mechanism" lower then
        FailNoMechanism

    else if String.contains "authentication failed" lower || String.contains "password" lower || String.contains "credential" lower then
        FailPassword

    else
        FailSignIn reason


failureCopy : ConnectFailure -> String
failureCopy failure =
    case failure of
        FailPassword ->
            "That name and password didn’t match an account. Check them and sign in again."

        FailTwoStep ->
            "This account uses two-step sign-in, which this screen can’t finish yet. Join as a guest instead, or sign in from another device."

        FailSaslTimeout ->
            "Sign-in took too long to answer. Try again in a moment."

        FailNoMechanism ->
            "Onyx didn’t offer a sign-in method this app supports. Try again later."

        FailSignIn reason ->
            "Sign-in didn’t work: " ++ reason

        FailRegisteredNick nick ->
            "“" ++ nick ++ "” belongs to an account. Sign in to use it, or pick another name."

        FailNickTaken nick ->
            "Someone is using “" ++ nick ++ "” right now, and the nearby names are taken too. Pick another name."

        FailNickRefused nick reason ->
            "“" ++ nick ++ "” can’t be used here (" ++ reason ++ "). Pick another name."

        FailServer reason ->
            reason



-- NICK COLLISIONS


{-| Underscore retries before a taken name fails (Solid `client.ts`
`_nickRetries < 4`). -}
maxNickRetries : Int
maxNickRetries =
    4


retryNick : String -> String
retryNick nick =
    nick ++ "_"


{-| 433 (in use) and 437 (held by nick delay) can clear with another
name; a 432 is about the name itself and never retries. -}
isRetryableNickError : String -> Bool
isRetryableNickError command =
    command == "433" || command == "437"



-- SERVER CLOSE REASONS


{-| The person-facing reason for a server `ERROR` (or KILL), and
whether reconnecting on our own would only fight it. Kills, bans,
access denials, ghosting by your own account and a newer login
elsewhere stop auto-reconnect; timeouts, flood, draining and
too-many-connections retry with backoff as before.

Server texts (onyx-server): `Closing Link: <nick> (Killed (<oper>
(<reason>)))`, `Closing Link: <nick> (Banned: <reason>)`,
`Closing Link: <nick> (Connection refused: … DNS blocklist …)`,
`Connection refused (reputation)`, SACCESS reasons (`Access denied
by SACCESS`), `Ghosted by <nick>`, `Session reclaimed (newer login
…)`, `Ping timeout`, `Registration timeout`, `Excess Flood`,
`Server is draining; try again later`, `Too many connections from
your host`.
-}
closeReason : String -> { text : String, fatal : Bool }
closeReason raw =
    let
        trimmed =
            String.trim raw

        inner =
            closingLinkInner trimmed

        lower =
            String.toLower inner
    in
    if String.startsWith "killed" lower then
        { text = "An operator disconnected you" ++ killDetail (String.dropLeft 6 inner), fatal = True }

    else if String.startsWith "banned" lower then
        { text = "This connection is banned from Onyx" ++ colonDetail (String.dropLeft 6 inner), fatal = True }

    else if String.startsWith "ghosted by" lower then
        { text = "Another session on your account signed this one out.", fatal = True }

    else if String.startsWith "session reclaimed" lower then
        { text = "You signed in somewhere else, so this session closed.", fatal = True }

    else if isFatalClose trimmed then
        { text = "Onyx refused this connection: " ++ inner, fatal = True }

    else if String.isEmpty inner then
        { text = "The server closed the connection.", fatal = False }

    else
        { text = "The server closed the connection: " ++ inner, fatal = False }


isFatalClose : String -> Bool
isFatalClose raw =
    let
        lower =
            String.toLower raw
    in
    List.any (\needle -> String.contains needle lower)
        [ "closing link", "banned", "killed", "access denied", "ghosted", "session reclaimed", "connection refused" ]


{-| `Closing Link: nick (X)` → `X`; anything else unchanged. -}
closingLinkInner : String -> String
closingLinkInner text =
    if String.startsWith "closing link:" (String.toLower text) then
        let
            rest =
                String.trim (String.dropLeft 13 text)
        in
        case String.indexes "(" rest of
            open :: _ ->
                let
                    body =
                        String.dropLeft (open + 1) rest
                in
                if String.endsWith ")" body then
                    String.trim (String.dropRight 1 body)

                else
                    String.trim body

            [] ->
                rest

    else
        text


{-| ` (oper (reason))` → `: reason (oper)`. -}
killDetail : String -> String
killDetail rest =
    let
        body =
            String.trim rest |> stripParens
    in
    case String.indexes "(" body of
        open :: _ ->
            let
                who =
                    String.trim (String.left open body)

                why =
                    String.dropLeft open body |> stripParens |> String.trim
            in
            if String.isEmpty why && String.isEmpty who then
                "."

            else if String.isEmpty why then
                " (" ++ who ++ ")."

            else if String.isEmpty who then
                ": " ++ why

            else
                ": " ++ why ++ " (" ++ who ++ ")"

        [] ->
            if String.isEmpty body then
                "."

            else
                " (" ++ body ++ ")."


colonDetail : String -> String
colonDetail rest =
    let
        body =
            String.trim rest
                |> (\s ->
                        if String.startsWith ":" s then
                            String.trim (String.dropLeft 1 s)

                        else
                            s
                   )
    in
    if String.isEmpty body then
        "."

    else
        ": " ++ body


stripParens : String -> String
stripParens s =
    if String.startsWith "(" s && String.endsWith ")" s then
        String.slice 1 -1 s

    else
        s



-- MOTD + WELCOME PACK


{-| A dismissed MOTD card stays away this long (the server MOTD is a
per-connection greeting with live figures, so its text changes every
time; the dismissal is time-based, not text-based). -}
motdHideMs : Float
motdHideMs =
    20 * 60 * 60 * 1000


motdVisible : Float -> Model -> Bool
motdVisible now model =
    model.motdDismissedAt <= 0 || now - model.motdDismissedAt > motdHideMs


{-| An onboarding pack line: `WELCOME :<line>` (a `WELCOME SHOW`
answer) or `[Welcome] <line>` (first login delivery). -}
takeWelcomeLine : String -> Maybe String
takeWelcomeLine notice =
    let
        line =
            if String.startsWith "WELCOME :" notice then
                Just (String.dropLeft 9 notice)

            else if String.startsWith "[Welcome] " notice then
                Just (String.dropLeft 10 notice)

            else
                Nothing
    in
    Maybe.andThen
        (\l ->
            if String.isEmpty (String.trim l) then
                Nothing

            else
                Just (String.trim l)
        )
        line



-- JOIN BY NAME


{-| `lounge` / `#lounge` → `#lounge`; refuses spaces, commas, control
characters and over-long names. -}
normalizeJoinName : String -> Result String String
normalizeJoinName raw =
    let
        trimmed =
            String.trim raw

        bare =
            if String.startsWith "#" trimmed then
                String.dropLeft 1 trimmed

            else
                trimmed
    in
    if String.isEmpty bare then
        Err "Type a room name, like #lounge."

    else if String.any (\c -> c == ' ' || c == ',' || Char.toCode c < 0x20 || Char.toCode c == 0x7F) bare then
        Err "Room names have no spaces or commas."

    else if String.length bare > 63 then
        Err "That room name is too long."

    else
        Ok ("#" ++ bare)



-- PORTS


type alias ShellEvent =
    { event : String
    , online : Maybe Bool
    , hangLabel : Maybe String
    , motdDismissedAt : Maybe Float
    }


decodeShellEvent : Decode.Value -> Maybe ShellEvent
decodeShellEvent value =
    Decode.decodeValue
        (Decode.map4 ShellEvent
            (Decode.field "event" Decode.string)
            (Decode.maybe (Decode.field "online" Decode.bool))
            (Decode.maybe (Decode.field "hangLabel" Decode.string))
            (Decode.maybe (Decode.field "motdDismissedAt" Decode.float))
        )
        value
        |> Result.toMaybe

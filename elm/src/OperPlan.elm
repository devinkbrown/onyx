module OperPlan exposing
    ( BanForm
    , BanKind(..)
    , Command
    , Duration
    , Intent(..)
    , SessionsForm
    , banKinds
    , banKindLabel
    , blankDuration
    , blankSessionsForm
    , durationPresets
    , durationSeconds
    , maxAnswerLength
    , maxAppealLength
    , maxReasonLength
    , plan
    , preview
    , serverQueries

    , toLine
    , tooBroad
    , wardActions
    , wardFacets
    , wardScopes
    )

{-| v3/gap-oper — turn what an operator typed into the exact wire line.

Every form in the desk answers `plan`: it either explains what is wrong
(`Err` — the desk shows the copy and sends nothing) or returns a
`Command` with a plain-language summary and the verbatim line. A command
that changes network state (`mutates`) is staged for review first; reads
send at once. Destructive ones (a ban, a rollback, a disconnect) are
styled as such.

The validators mirror the daemon's: ward / shun patterns go through the
same `wildcard_limit` policy (`channel_ban`: at least three literal
bytes, at most three `*`) so a catch-all mask is refused here instead of
bouncing off the server, while the server stays the authority.

Free text always rides as the trailing parameter with an explicit `:`
(see `toLine`): a reason that is one word or looks like a duration must
not be mistaken for a positional token by `WARD ADD`'s scanner.

-}

import OperReply exposing (Section(..))


type alias Command =
    { verb : String
    , args : List String
    , trailing : Maybe String
    , summary : String
    , mutates : Bool
    , destructive : Bool
    , section : Section
    }


{-| The line, CRLF-terminated. -}
toLine : Command -> String
toLine command =
    preview command ++ "\u{000D}\n"


{-| The line as the review shows it. -}
preview : Command -> String
preview command =
    String.join " "
        (command.verb
            :: command.args
            ++ (case command.trailing of
                    Just text ->
                        [ ":" ++ text ]

                    Nothing ->
                        []
               )
        )


type BanKind
    = Kline
    | Dline
    | Xline
    | Ward


banKinds : List BanKind
banKinds =
    [ Kline, Dline, Xline, Ward ]


banKindLabel : BanKind -> String
banKindLabel kind =
    case kind of
        Kline ->
            "Server ban (nick!user@host)"

        Dline ->
            "Address ban (IP or CIDR)"

        Xline ->
            "Real-name ban"

        Ward ->
            "Custom ward"


wardFacets : List String
wardFacets =
    [ "mask", "address", "host", "account", "realname", "certfp", "country", "asn" ]


wardScopes : List String
wardScopes =
    [ "node", "mesh" ]


wardActions : List String
wardActions =
    [ "expel", "refuse", "quarantine", "require_auth" ]


{-| `choice` is "0" (permanent), a preset in seconds, or "custom" (then
`amount` × `unit`). -}
type alias Duration =
    { choice : String
    , amount : String
    , unit : String
    }


blankDuration : Duration
blankDuration =
    { choice = "0", amount = "", unit = "hours" }


durationPresets : List ( String, String )
durationPresets =
    [ ( "0", "Permanent" )
    , ( "3600", "1 hour" )
    , ( "21600", "6 hours" )
    , ( "86400", "1 day" )
    , ( "604800", "7 days" )
    , ( "2592000", "30 days" )
    , ( "custom", "Custom…" )
    ]


maxDurationSeconds : Int
maxDurationSeconds =
    3650 * 86400


durationSeconds : Duration -> Result String Int
durationSeconds duration =
    if duration.choice == "custom" then
        case String.toInt (String.trim duration.amount) of
            Nothing ->
                Err "Enter how long the ban should last, as a whole number."

            Just n ->
                let
                    unit =
                        case duration.unit of
                            "minutes" ->
                                60

                            "days" ->
                                86400

                            _ ->
                                3600

                    seconds =
                        n * unit
                in
                if n < 1 then
                    Err "A custom duration must be at least 1."

                else if seconds > maxDurationSeconds then
                    Err "Keep a timed ban under ten years, or choose Permanent."

                else
                    Ok seconds

    else
        case String.toInt duration.choice of
            Just n ->
                if n >= 0 && n <= maxDurationSeconds then
                    Ok n

                else
                    Err "Pick a duration from the list."

            Nothing ->
                Err "Pick a duration from the list."


describeDuration : Int -> String
describeDuration seconds =
    if seconds == 0 then
        "permanently"

    else if seconds >= 86400 && modBy 86400 seconds == 0 then
        "for " ++ countOf (seconds // 86400) "day" "days"

    else if seconds >= 3600 && modBy 3600 seconds == 0 then
        "for " ++ countOf (seconds // 3600) "hour" "hours"

    else if seconds >= 60 && modBy 60 seconds == 0 then
        "for " ++ countOf (seconds // 60) "minute" "minutes"

    else
        "for " ++ countOf seconds "second" "seconds"


countOf : Int -> String -> String -> String
countOf n one many =
    String.fromInt n
        ++ " "
        ++ (if n == 1 then
                one

            else
                many
           )


type alias BanForm =
    { kind : BanKind
    , match : String
    , pattern : String
    , scope : String
    , action : String
    , duration : Duration
    , reason : String
    }


type alias SessionsForm =
    { who : String
    , transport : String
    , account : String
    , ip : String
    , sort : String
    , limit : String
    }


blankSessionsForm : SessionsForm
blankSessionsForm =
    { who = "", transport = "", account = "", ip = "", sort = "-connected", limit = "50" }


type Intent
    = BanAdd BanForm
    | BanRemove { match : String, pattern : String }
    | BanList
    | BanTest { match : String, value : String }
    | TestLine String
    | TestMask String
    | ShunAdd { mask : String, duration : Duration, reason : String }
    | ShunRemove String
    | ShunList
    | GagUser { nick : String, on : Bool }
    | Quarantine { nick : String, channel : String, reason : String }
    | AbuseCheck String
    | ClonesScan
    | SessionsList SessionsForm
    | AppealsList
    | AppealAnswer { id : String, text : String }
    | AppealSubmit String
    | FilterList
    | FilterAdd String
    | FilterRemove String
    | SpamtrapStatus
    | SpamtrapSet { add : Bool, kind : String, target : String }
    | HoldAct { release : Bool, channel : String, nick : String }
    | PolicyShow
    | PolicyRollback
    | ChallengeMethod String
    | ChallengeQuestion { question : String, answer : String }
    | Follow { category : String, on : Bool }
    | MinSeverity String
    | EventsReport
    | EventStats
    | ServerQuery { verb : String, arg : String }


{-| Read-only server queries the Network tab offers, each with the
argument shapes the daemon accepts (`MESH [LOG|GRANTS|ADMISSION]`,
`STATS <letter>`, `AUDIT [count]`). -}
serverQueries : List { verb : String, arg : String, label : String, hint : String }
serverQueries =
    [ { verb = "MESH", arg = "", label = "Mesh peers", hint = "Linked nodes, their round-trip times and whether the mesh is split." }
    , { verb = "MESH", arg = "LOG", label = "Mesh event log", hint = "Recent link, split and rejoin events." }
    , { verb = "MESH", arg = "GRANTS", label = "Cross-mesh grants", hint = "Operator grants other nodes recognise." }
    , { verb = "MESH", arg = "ADMISSION", label = "Mesh admission", hint = "How nodes are admitted to the mesh." }
    , { verb = "NETHEALTH", arg = "", label = "Network health", hint = "Which nodes answer, how fast, and whether this node holds quorum." }
    , { verb = "ROUTE", arg = "", label = "Routes", hint = "Which node is the next hop for each destination." }
    , { verb = "GRANTS", arg = "", label = "Operator grants", hint = "Runtime operator grants on this node." }
    , { verb = "AUDIT", arg = "20", label = "Recent audit rows", hint = "The last 20 operator actions, with their proof ids." }
    , { verb = "STATS", arg = "u", label = "Uptime", hint = "How long this node has been running." }
    , { verb = "STATS", arg = "o", label = "Operator accounts", hint = "Configured operator bindings." }
    , { verb = "STATS", arg = "k", label = "Server bans", hint = "Active K-lines." }
    , { verb = "STATS", arg = "d", label = "Address bans", hint = "Active D-lines." }
    , { verb = "STATS", arg = "y", label = "Connection classes", hint = "Limits and live counts for each connection class." }
    , { verb = "STATS", arg = "l", label = "Server links", hint = "Established links with queue sizes and uptime." }
    , { verb = "STATS", arg = "z", label = "Runtime counters", hint = "Internal counters for this node." }
    , { verb = "STATS", arg = "m", label = "Command usage", hint = "How often each command has run." }
    ]


maxReasonLength : Int
maxReasonLength =
    200


maxAppealLength : Int
maxAppealLength =
    400


maxAnswerLength : Int
maxAnswerLength =
    400


maxPatternLength : Int
maxPatternLength =
    256


plan : Intent -> Result (List String) Command
plan intent =
    case intent of
        BanAdd form ->
            planBanAdd form

        BanRemove { match, pattern } ->
            Result.map2
                (\m p ->
                    mk Bans "WARD" [ "DEL", m, p ] Nothing ("Lift the " ++ m ++ " ban on " ++ p ++ ".") True False
                )
                (facetOf match)
                (token maxPatternLength "pattern" pattern)
                |> collapse

        BanList ->
            Ok (mk Bans "WARD" [ "LIST" ] Nothing "List every ward on this node." False False)

        BanTest { match, value } ->
            Result.map2
                (\m v ->
                    mk Bans "WARD" [ "TEST", m, v ] Nothing ("Check whether a ward matches " ++ v ++ ".") False False
                )
                (facetOf match)
                (token maxPatternLength "value" value)
                |> collapse

        TestLine target ->
            token maxPatternLength "address, host or mask" target
                |> Result.map (\t -> mk Bans "TESTLINE" [ t ] Nothing ("Check whether " ++ t ++ " is banned.") False False)
                |> Result.mapError List.singleton

        TestMask mask ->
            token maxPatternLength "mask" mask
                |> Result.map (\m -> mk Bans "TESTMASK" [ m ] Nothing ("Count connected people who match " ++ m ++ ".") False False)
                |> Result.mapError List.singleton

        ShunAdd { mask, duration, reason } ->
            Result.map3
                (\m secs r ->
                    mk Silence
                        "SHUN"
                        ([ m ] ++ secondsArg secs)
                        (Just r)
                        ("Silently drop everything from " ++ m ++ " " ++ describeDuration secs ++ ". They are not told. Reason: " ++ r)
                        True
                        True
                )
                (broadMask "mask" mask)
                (listErr (durationSeconds duration))
                (requiredReason reason)

        ShunRemove mask ->
            token maxPatternLength "mask" mask
                |> Result.map (\m -> mk Silence "UNSHUN" [ m ] Nothing ("Lift the shun on " ++ m ++ ".") True False)
                |> Result.mapError List.singleton

        ShunList ->
            Ok (mk Silence "SHUN" [] Nothing "List the active shuns." False False)

        GagUser { nick, on } ->
            nickOf nick
                |> Result.map
                    (\n ->
                        mk Silence
                            "MODE"
                            [ n
                            , if on then
                                "+z"

                              else
                                "-z"
                            ]
                            Nothing
                            (if on then
                                "Gag " ++ n ++ ": silenced by their address, so it survives reconnecting."

                             else
                                "Lift the gag on " ++ n ++ " and their address."
                            )
                            True
                            on
                    )
                |> Result.mapError List.singleton

        Quarantine { nick, channel, reason } ->
            Result.map3
                (\n c r ->
                    mk Silence
                        "QUARANTINE"
                        [ n, c ]
                        (Just r)
                        ("Part " ++ n ++ " from every room and move them to " ++ c ++ ". Reason: " ++ r)
                        True
                        True
                )
                (listErr (nickOf nick))
                (listErr (channelOf channel))
                (requiredReason reason)

        AbuseCheck nick ->
            nickOf nick
                |> Result.map (\n -> mk Abuse "ABUSE" [ n ] Nothing ("Show why " ++ n ++ " might be throttled, shunned or flagged.") False False)
                |> Result.mapError List.singleton

        ClonesScan ->
            Ok (mk Abuse "CLONES" [] Nothing "Scan connected people for clone groups." False False)

        SessionsList form ->
            planSessions form

        AppealsList ->
            Ok (mk Appeals "APPEAL" [ "LIST" ] Nothing "List the appeals people have filed." False False)

        AppealAnswer { id, text } ->
            case ( String.toInt (String.trim id), freeText maxAnswerLength "answer" text ) of
                ( Just n, Ok t ) ->
                    if n < 1 then
                        Err [ "Pick an appeal first." ]

                    else
                        Ok (mk Appeals "APPEAL" [ "ANSWER", String.fromInt n ] (Just t) ("Record this answer on appeal " ++ String.fromInt n ++ ". The server stores and audits it; it does not message the person.") True False)

                ( Nothing, _ ) ->
                    Err [ "Pick an appeal first." ]

                ( _, Err message ) ->
                    Err [ message ]

        AppealSubmit text ->
            freeText maxAppealLength "appeal" text
                |> Result.map (\t -> mk Appeals "APPEAL" [] (Just t) "File an appeal with the network's operators." True False)
                |> Result.mapError List.singleton

        FilterList ->
            Ok (mk Content "FILTER" [ "LIST" ] Nothing "List the content-filter patterns." False False)

        FilterAdd pattern ->
            filterPattern pattern
                |> Result.map
                    (\p ->
                        mk Content
                            "FILTER"
                            [ "ADD" ]
                            (Just p)
                            ("Block messages from non-operators that contain \u{201C}" ++ p ++ "\u{201D}, network-wide.")
                            True
                            True
                    )
                |> Result.mapError List.singleton

        FilterRemove pattern ->
            filterPattern pattern
                |> Result.map (\p -> mk Content "FILTER" [ "DEL" ] (Just p) ("Stop blocking \u{201C}" ++ p ++ "\u{201D}.") True False)
                |> Result.mapError List.singleton

        SpamtrapStatus ->
            Ok (mk Content "SPAMTRAP" [ "LIST" ] Nothing "Show the spam-trap counters." False False)

        SpamtrapSet { add, kind, target } ->
            let
                kindWord =
                    if kind == "CHAN" then
                        "CHAN"

                    else
                        "NICK"

                verb =
                    if add then
                        "ADD"

                    else
                        "DEL"

                checked =
                    if kindWord == "CHAN" then
                        channelOf target

                    else
                        nickOf target
            in
            checked
                |> Result.map
                    (\t ->
                        mk Content
                            "SPAMTRAP"
                            [ verb, kindWord, t ]
                            Nothing
                            (if add then
                                "Treat any non-operator who touches " ++ t ++ " as a spammer and alert operators."

                             else
                                "Remove the spam trap on " ++ t ++ "."
                            )
                            True
                            False
                    )
                |> Result.mapError List.singleton

        HoldAct { release, channel, nick } ->
            Result.map2
                (\c n ->
                    mk Content
                        "HOLD"
                        [ if release then
                            "RELEASE"

                          else
                            "DROP"
                        , c
                        , n
                        ]
                        Nothing
                        (if release then
                            "Deliver " ++ n ++ "'s held first messages to " ++ c ++ "."

                         else
                            "Discard " ++ n ++ "'s held first messages for " ++ c ++ "."
                        )
                        True
                        (not release)
                )
                (channelOf channel)
                (nickOf nick)
                |> collapse

        PolicyShow ->
            Ok (mk Content "POLICY" [ "LIST" ] Nothing "Show the current policy generations." False False)

        PolicyRollback ->
            Ok (mk Content "POLICY" [ "ROLLBACK" ] Nothing "Undo the most recent ward, filter, class or ban policy change." True True)

        ChallengeMethod method ->
            if method == "pow" || method == "question" then
                Ok
                    (mk Content
                        "CHALLENGE"
                        [ "METHOD", method ]
                        Nothing
                        (if method == "pow" then
                            "New connections during a raid solve a small proof-of-work."

                         else
                            "New connections during a raid answer your question."
                        )
                        True
                        False
                    )

            else
                Err [ "Choose proof-of-work or a question." ]

        ChallengeQuestion { question, answer } ->
            Result.map2
                (\q a ->
                    mk Content
                        "CHALLENGE"
                        [ "QUESTION", q ]
                        (Just a)
                        "New connections during a raid are shown this question and must answer it."
                        True
                        False
                )
                (challengeText 160 "question" question)
                (challengeText 64 "answer" answer)

                |> collapse

        Follow { category, on } ->
            Ok
                (mk Feed
                    "EVENT"
                    [ if on then
                        "ADD"

                      else
                        "DEL"
                    , category
                    ]
                    Nothing
                    (if on then
                        "Follow " ++ category ++ " events in the live feed."

                     else
                        "Stop following " ++ category ++ " events."
                    )
                    False
                    False
                )

        MinSeverity floor ->
            if List.member floor [ "debug", "info", "notice", "warn", "error", "critical" ] then
                Ok (mk Feed "EVENT" [ "SEVERITY", floor ] Nothing ("Only deliver " ++ floor ++ " and louder events to this session.") False False)

            else
                Err [ "Pick a severity from the list." ]

        EventsReport ->
            Ok (mk Feed "EVENT" [ "LIST" ] Nothing "Ask which categories this session follows." False False)

        EventStats ->
            Ok (mk Feed "EVENT" [ "STATS", "JSON" ] Nothing "Count the events the node has published since it started." False False)

        ServerQuery { verb, arg } ->
            if List.any (\q -> q.verb == verb && q.arg == arg) serverQueries then
                Ok
                    (mk Network
                        verb
                        (if arg == "" then
                            []

                         else
                            [ arg ]
                        )
                        Nothing
                        ("Ask this node for " ++ String.toLower verb ++ (if arg == "" then "" else " " ++ arg) ++ ".")
                        False
                        False
                    )

            else
                Err [ "That query is not one the desk offers." ]


mk : Section -> String -> List String -> Maybe String -> String -> Bool -> Bool -> Command
mk section verb args trailing summary mutates destructive =
    { verb = verb
    , args = args
    , trailing = trailing
    , summary = summary
    , mutates = mutates
    , destructive = destructive
    , section = section
    }


secondsArg : Int -> List String
secondsArg secs =
    if secs > 0 then
        [ String.fromInt secs ]

    else
        []


collapse : Result String a -> Result (List String) a
collapse result =
    Result.mapError List.singleton result


listErr : Result String a -> Result (List String) a
listErr result =
    Result.mapError List.singleton result



-- BANS


planBanAdd : BanForm -> Result (List String) Command
planBanAdd form =
    let
        match =
            case form.kind of
                Kline ->
                    "mask"

                Dline ->
                    "address"

                Xline ->
                    "realname"

                Ward ->
                    form.match

        patternResult =
            -- Addresses are exempt on the daemon. Country codes are two
            -- letters, which the daemon's literal-byte policy would also
            -- refuse; let the daemon say so (the desk shows its reply)
            -- rather than guessing here.
            if match == "address" || match == "country" then
                token maxPatternLength "address" form.pattern


            else
                broadMask "pattern" form.pattern
                    |> Result.mapError (String.join " ")

        errors =
            List.filterMap
                identity
                [ case patternResult of
                    Err message ->
                        Just message

                    Ok _ ->
                        Nothing
                , case durationSeconds form.duration of
                    Err message ->
                        Just message

                    Ok _ ->
                        Nothing
                , case requiredReason form.reason of
                    Err messages ->
                        List.head messages

                    Ok _ ->
                        Nothing
                , if form.kind == Ward && not (List.member form.match wardFacets) then
                    Just "Pick what the ward matches."

                  else
                    Nothing
                , if form.kind == Ward && not (List.member form.scope wardScopes) then
                    Just "Pick where the ward applies."

                  else
                    Nothing
                , if form.kind == Ward && not (List.member form.action wardActions) then
                    Just "Pick what happens to a match."

                  else
                    Nothing
                ]
    in
    case ( patternResult, durationSeconds form.duration, requiredReason form.reason ) of
        ( Ok pattern, Ok secs, Ok reason ) ->
            if List.isEmpty errors then
                case form.kind of
                    Ward ->
                        Ok
                            (mk Bans
                                "WARD"
                                ([ "ADD", match, pattern, form.scope, form.action ] ++ secondsArg secs)
                                (Just reason)
                                (wardSummary match pattern form.scope form.action secs reason)
                                True
                                True
                            )

                    _ ->
                        let
                            verb =
                                case form.kind of
                                    Dline ->
                                        "DLINE"

                                    Xline ->
                                        "XLINE"

                                    _ ->
                                        "KLINE"

                            action =
                                if form.kind == Dline then
                                    "refuse"

                                else
                                    "expel"
                        in
                        Ok
                            (mk Bans
                                verb
                                ([ "ADD", pattern ] ++ secondsArg secs)
                                (Just reason)
                                (wardSummary match pattern "node" action secs reason)
                                True
                                True
                            )

            else
                Err errors

        _ ->
            Err errors


wardSummary : String -> String -> String -> String -> Int -> String -> String
wardSummary match pattern scope action secs reason =
    let
        where_ =
            if scope == "mesh" then
                "across the whole mesh"

            else
                "on this node"

        effect =
            case action of
                "refuse" ->
                    "Refuses the connection"

                "quarantine" ->
                    "Lets them connect but blocks joining and speaking"

                "require_auth" ->
                    "Only lets signed-in accounts through"

                _ ->
                    "Disconnects them"
    in
    effect
        ++ " when the "
        ++ match
        ++ " matches "
        ++ pattern
        ++ ", "
        ++ where_
        ++ ", "
        ++ describeDuration secs
        ++ ". Reason: "
        ++ reason


facetOf : String -> Result String String
facetOf match =
    if List.member match wardFacets then
        Ok match

    else
        Err "Pick what the ward matches."



-- SESSIONS


planSessions : SessionsForm -> Result (List String) Command
planSessions form =
    let
        who =
            case form.who of
                "oper" ->
                    [ "oper" ]

                "user" ->
                    [ "user" ]

                _ ->
                    []

        transport =
            case form.transport of
                "tls" ->
                    [ "tls" ]

                "clear" ->
                    [ "clear" ]

                _ ->
                    []

        glob key value =
            let
                clean =
                    String.trim value
            in
            if clean == "" then
                Ok []

            else if String.length clean > 128 || String.any isSpaceOrControl clean || String.contains "=" clean then
                Err ("The " ++ key ++ " filter cannot have spaces and is at most 128 characters.")

            else
                Ok [ key ++ "=" ++ clean ]

        sort =
            case String.trim form.sort of
                "" ->
                    Ok []

                value ->
                    if List.all sortPartOk (String.split "," value) && List.length (String.split "," value) <= 4 then
                        Ok [ "sort=" ++ value ]

                    else
                        Err "Sort by nick, account, ip, connected, oper or tls (a leading - reverses)."

        limit =
            case String.trim form.limit of
                "" ->
                    Ok []

                value ->
                    case String.toInt value of
                        Just n ->
                            if n >= 1 && n <= 500 then
                                Ok [ "limit=" ++ String.fromInt n ]

                            else
                                Err "Show between 1 and 500 sessions."

                        Nothing ->
                            Err "Show between 1 and 500 sessions."

        parts =
            [ Ok who, Ok transport, glob "account" form.account, glob "ip" form.ip, sort, limit ]

        errors =
            List.filterMap
                (\r ->
                    case r of
                        Err message ->
                            Just message

                        Ok _ ->
                            Nothing
                )
                parts
    in
    if List.isEmpty errors then
        let
            words =
                List.concatMap (Result.withDefault []) parts
        in
        Ok
            (mk Abuse
                "SESSIONS"
                []
                (if List.isEmpty words then
                    Nothing

                 else
                    Just (String.join " " words)
                )
                "List connected sessions with these filters."

                False
                False
            )

    else
        Err errors


sortKeys : List String
sortKeys =
    [ "nick", "account", "ip", "connected", "oper", "tls" ]


sortPartOk : String -> Bool
sortPartOk part =
    if String.startsWith "-" part || String.startsWith "+" part then
        List.member (String.dropLeft 1 part) sortKeys

    else
        List.member part sortKeys



-- VALIDATORS


isSpaceOrControl : Char -> Bool
isSpaceOrControl c =
    let
        code =
            Char.toCode c
    in
    code <= 0x20 || code == 0x7F || c == '\u{00A0}' || c == '\u{3000}'


hasControl : String -> Bool
hasControl value =
    String.any (\c -> Char.toCode c < 0x20 || Char.toCode c == 0x7F) value


{-| One middle parameter: bounded, no whitespace or controls, not
colon-led (it would turn the rest of the line into trailing text). -}
token : Int -> String -> String -> Result String String
token max label value =
    let
        clean =
            String.trim value
    in
    if clean == "" then
        Err ("Enter the " ++ label ++ ".")

    else if String.length clean > max then
        Err ("Keep the " ++ label ++ " under " ++ String.fromInt max ++ " characters.")

    else if String.any isSpaceOrControl clean then
        Err ("The " ++ label ++ " cannot contain spaces or control characters.")

    else if String.startsWith ":" clean then
        Err ("The " ++ label ++ " cannot start with a colon.")

    else
        Ok clean


{-| A ward / shun pattern: a token that also clears the daemon's
`channel_ban` specificity policy. -}
broadMask : String -> String -> Result (List String) String
broadMask label value =
    case token maxPatternLength label value of
        Err message ->
            Err [ message ]

        Ok clean ->
            if tooBroad clean then
                Err [ "That " ++ label ++ " matches too much. Add more literal characters (at least three, and no more than three *)." ]

            else
                Ok clean


{-| Mirror of `wildcard_limit.isTooBroad(_, channel_ban)`: fewer than
three literal bytes or more than three unescaped `*`. A backslash
escapes only `*`, `?` and `\`. -}
tooBroad : String -> Bool
tooBroad pattern =
    let
        go chars stars literals =
            case chars of
                [] ->
                    ( stars, literals )

                '\\' :: next :: rest ->
                    if next == '*' || next == '?' || next == '\\' then
                        go rest stars (literals + 2)

                    else
                        go (next :: rest) stars (literals + 1)

                '*' :: rest ->
                    go rest (stars + 1) literals

                '?' :: rest ->
                    go rest stars literals

                _ :: rest ->
                    go rest stars (literals + 1)

        ( starCount, literalCount ) =
            go (String.toList pattern) 0 0
    in
    literalCount < 3 || starCount > 3


requiredReason : String -> Result (List String) String
requiredReason value =
    case freeText maxReasonLength "reason" value of
        Err message ->
            Err [ message ]

        Ok clean ->
            if String.length clean < 3 then
                Err [ "Give a reason of a few words; it is recorded with the action." ]

            else
                Ok clean


freeText : Int -> String -> String -> Result String String
freeText max label value =
    let
        clean =
            String.trim value
    in
    if hasControl clean then
        Err ("The " ++ label ++ " cannot include line breaks or control characters.")

    else if clean == "" then
        Err ("Write the " ++ label ++ " first.")

    else if String.length clean > max then
        Err ("Keep the " ++ label ++ " under " ++ String.fromInt max ++ " characters.")

    else
        Ok clean


filterPattern : String -> Result String String
filterPattern value =
    case freeText 120 "pattern" value of
        Err message ->
            Err message

        Ok clean ->
            if String.length clean < 3 then
                Err "A filter pattern needs at least three characters."

            else
                Ok clean


{-| Challenge question / answer: the question is one middle parameter
on the wire, so it cannot hold spaces (the daemon reads it as a
single token); the answer is the trailing text. -}
challengeText : Int -> String -> String -> Result String String
challengeText max label value =
    if label == "question" then
        token max label (String.replace " " "_" (String.trim value))

    else
        freeText max label value


nickOf : String -> Result String String
nickOf value =
    let
        clean =
            String.trim value
    in
    if clean == "" then
        Err "Enter a nickname."

    else if String.length clean > 50 then
        Err "That nickname is too long."

    else if String.any (\c -> isSpaceOrControl c || List.member c [ ',', ':', '*', '?', '!', '@' ]) clean then
        Err "Enter a single nickname, without wildcards or spaces."

    else
        Ok clean


channelOf : String -> Result String String
channelOf value =
    let
        clean =
            String.trim value
    in
    if clean == "" then
        Err "Enter a channel name."

    else if not (String.startsWith "#" clean || String.startsWith "&" clean) then
        Err "A channel name starts with # or &."

    else if String.length clean > 64 || String.any (\c -> isSpaceOrControl c || c == ',' || c == ':') clean then
        Err "That channel name is not valid."

    else
        Ok clean

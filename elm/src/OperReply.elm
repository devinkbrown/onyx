module OperReply exposing
    ( Appeal
    , CloneCluster
    , CloneMember
    , Reply(..)
    , Section(..)
    , Session
    , Shun
    , Tone(..)
    , Ward
    , classify
    , describe
    , isErrorNumeric
    , parseCloneMember
    , sectionLabel
    , sectionOf
    , sections
    , toneOf
    )

{-| v3/gap-oper — what the daemon says back to operator commands.

Almost every operator reply is a `:<server> NOTICE <you> :<TOKEN> …`
line (`noticeTo`), a numeric (`replyNumeric`), a standard reply, or an
Event Spine row. Until now they all fell into the invisible service log.
`classify` reads ONE line and says what it is, from the exact shapes the
daemon writes (`oper_cmd.zig`, `server.zig handleAppeal / handleFilter /
handlePolicy / handleHold / handleQuarantine / handleClones`,
`svc_sessionview.zig`). It is pure and context-free: deciding whether a
line that *no* pattern claims belongs to the desk is the console's job.

Only server-origin lines are read (`message.nick == Nothing`): a person
cannot forge a `WARD …` row into the desk with a NOTICE.

-}

import Wire


{-| The desk's tabs that own replies. -}
type Section
    = Live
    | Bans
    | Silence
    | Abuse
    | Appeals
    | Content
    | Network


sections : List Section
sections =
    [ Live, Bans, Silence, Abuse, Appeals, Content, Network ]


sectionLabel : Section -> String
sectionLabel section =
    case section of
        Live ->
            "Live"

        Bans ->
            "Bans"

        Silence ->
            "Silence"

        Abuse ->
            "Abuse"

        Appeals ->
            "Appeals"

        Content ->
            "Content"

        Network ->
            "Network"


type Tone
    = Plain
    | Good
    | Warn
    | Bad


type alias Ward =
    { match : String
    , pattern : String
    , scope : String
    , action : String
    , setBy : String
    , reason : String
    }


type alias Shun =
    { mask : String
    , setBy : String
    , reason : String
    }


type alias Appeal =
    { id : Int
    , nick : String
    , host : String
    , answered : Bool
    , text : String
    }


type alias Session =
    { oper : Bool
    , nick : String
    , ip : String
    , seconds : Int
    , tls : Bool
    , account : String
    }


type alias CloneCluster =
    { kind : String
    , key : String
    , count : Int
    }


type alias CloneMember =
    { nick : String
    , ip : String
    , account : String
    }


type Reply
    = WardRow Ward
    | WardEnd
    | WardTested { matched : Bool, text : String }
    | LineTested { target : String, matchedBy : Maybe { match : String, pattern : String, reason : String } }
    | MaskTested { mask : String, count : Int }
    | ShunRow Shun
    | ShunEnd
    | GagSet { nick : String, on : Bool }
    | QuarantineMoved
    | AbuseFact { nick : String, topic : String, detail : String }
    | AbuseNoNick
    | ClonesPolicy String
    | ClonesHeader CloneCluster
    | ClonesNone
    | SessionRow Session
    | SessionsEnd
    | AppealRow Appeal
    | AppealNone
    | AppealFiled Int
    | AppealAlready
    | AppealAnswered
    | AppealNoSuchId
    | FilterRow { index : Int, pattern : String }
    | FilterEnd Int
    | FilterChanged { added : Bool }
    | SpamtrapSummary { nicks : Int, channels : Int, offenders : Int, trips : Int }
    | HoldDone { released : Bool, count : Int }
    | PolicyGenerations { ward : Int, filter : Int, class : Int, ban : Int }
    | PolicyRolled String
    | EventCategories { subscribed : List String, minSeverity : String }
    | EventSeverityIs String
    | EventStatsText String
    | PrivilegeList { class : String, privileges : List String }
    | RehashDone String
    | Denied String
    | NeedParams { command : String, text : String }
    | NoSuchNick String
    | Failed { command : String, code : String, text : String }
    | Said { section : Section, text : String }


isServerOrigin : Wire.IrcMessage -> Bool
isServerOrigin message =
    message.nick == Nothing


{-| Read one line. `Nothing` means no operator-desk pattern claims it. -}
classify : Wire.IrcMessage -> Maybe Reply
classify message =
    if not (isServerOrigin message) then
        Nothing

    else
        case message.command of
            "NOTICE" ->
                classifyNotice (lastParam message.params)

            "FAIL" ->
                classifyFail message.params

            "MODE" ->
                classifyGag message.params

            "204" ->
                sessionRow True message.params

            "205" ->
                sessionRow False message.params

            "262" ->
                case message.params of
                    _ :: "SESSION" :: _ ->
                        Just SessionsEnd

                    _ ->
                        Nothing

            "270" ->
                case message.params of
                    [ _, _, class, list ] ->
                        Just (PrivilegeList { class = class, privileges = String.words list })

                    _ ->
                        Nothing

            "382" ->
                case List.drop 1 message.params of
                    _ :: text :: _ ->
                        Just (RehashDone text)

                    [ text ] ->
                        Just (RehashDone text)

                    [] ->
                        Nothing

            "401" ->
                case message.params of
                    _ :: nick :: _ ->
                        Just (NoSuchNick nick)

                    _ ->
                        Nothing

            "461" ->
                case message.params of
                    _ :: command :: text :: _ ->
                        Just (NeedParams { command = command, text = text })

                    _ ->
                        Nothing

            "481" ->
                Just (Denied (lastParam message.params))

            "725" ->
                case message.params of
                    [ _, match, pattern, reason ] ->
                        Just (LineTested { target = pattern, matchedBy = Just { match = match, pattern = pattern, reason = reason } })

                    _ ->
                        Nothing

            "726" ->
                case message.params of
                    _ :: target :: _ ->
                        Just (LineTested { target = target, matchedBy = Nothing })

                    _ ->
                        Nothing

            "727" ->
                case message.params of
                    _ :: mask :: count :: _ ->
                        Maybe.map (\n -> MaskTested { mask = mask, count = n }) (String.toInt count)

                    _ ->
                        Nothing

            _ ->
                Nothing


lastParam : List String -> String
lastParam params =
    Maybe.withDefault "" (List.head (List.reverse params))


{-| Numerics that mean "that command failed" (4xx / 5xx / 9xx); the
console attributes them to the command it just sent. -}
isErrorNumeric : String -> Bool
isErrorNumeric command =
    String.length command == 3
        && String.all Char.isDigit command
        && List.member (String.left 1 command) [ "4", "5", "9" ]


classifyNotice : String -> Maybe Reply
classifyNotice text =
    if String.startsWith "WARD" text then
        classifyWard text

    else if String.startsWith "SHUN" text then
        classifyShun text

    else if String.startsWith "ABUSE" text then
        classifyAbuse text

    else if String.startsWith "CLONES" text then
        classifyClones text

    else if String.startsWith "APPEAL" text then
        classifyAppeal text

    else if String.startsWith "FILTER" text then
        classifyFilter text

    else if String.startsWith "SPAMTRAP" text then
        classifySpamtrap text

    else if String.startsWith "HOLD" text then
        classifyHold text

    else if String.startsWith "POLICY" text then
        classifyPolicy text

    else if String.startsWith "CHALLENGE" text then
        Just (Said { section = Content, text = text })

    else if text == "QUARANTINE moved" then
        Just QuarantineMoved

    else if String.startsWith "Event categories:" text then
        Just (eventCategories text)

    else if String.startsWith "Event minimum severity" text || String.startsWith "Unknown severity" text then

        Just (EventSeverityIs text)

    else if String.startsWith "Event stats" text || String.startsWith "  by category:" text || String.startsWith "  by severity:" text then
        Just (EventStatsText text)

    else if String.startsWith "All event subscriptions cleared" text then
        Just (Said { section = Live, text = text })

    else if String.startsWith "OBSERVE:" text then
        Just (Said { section = Live, text = text })

    else if String.startsWith "KILL:" text then
        Just (Said { section = Network, text = text })

    else
        Nothing



-- BANS


classifyWard : String -> Maybe Reply
classifyWard text =
    if text == "WARD: end of list" then
        Just WardEnd

    else if String.startsWith "WARD TEST: matched " text then
        Just (WardTested { matched = True, text = String.dropLeft 19 text })

    else if text == "WARD TEST: no match" then
        Just (WardTested { matched = False, text = "No ward matches that value." })

    else if String.startsWith "WARD: " text || String.startsWith "WARD TEST" text then
        Just (Said { section = Bans, text = text })

    else
        let
            ( head, reason ) =
                splitReason text
        in
        case String.words head of
            [ "WARD", match, pattern, scopeAction, "by", setBy ] ->
                case String.split "/" scopeAction of
                    [ scope, action ] ->
                        Just (WardRow { match = match, pattern = pattern, scope = scope, action = action, setBy = setBy, reason = reason })

                    _ ->
                        Nothing

            _ ->
                Nothing



-- SILENCE


classifyShun : String -> Maybe Reply
classifyShun text =
    if text == "SHUN: end of list" then
        Just ShunEnd

    else if String.startsWith "SHUN: " text then
        Just (Said { section = Silence, text = text })

    else
        let
            ( head, reason ) =
                splitReason text
        in
        case String.words head of
            [ "SHUN", mask, "by", setBy ] ->
                Just (ShunRow { mask = mask, setBy = setBy, reason = reason })

            _ ->
                Nothing


classifyGag : List String -> Maybe Reply
classifyGag params =
    case params of
        [ nick, mode ] ->
            if String.endsWith "z" mode && (String.startsWith "+" mode || String.startsWith "-" mode) && not (String.startsWith "#" nick) then
                Just (GagSet { nick = nick, on = String.startsWith "+" mode })

            else
                Nothing

        _ ->
            Nothing



-- ABUSE


classifyAbuse : String -> Maybe Reply
classifyAbuse text =
    if text == "ABUSE: no such nick" then
        Just AbuseNoNick

    else
        case String.words text of
            "ABUSE" :: who :: topic :: rest ->
                if String.endsWith ":" who then
                    Just (AbuseFact { nick = String.dropRight 1 who, topic = topic, detail = String.join " " rest })

                else
                    Nothing

            _ ->
                Nothing


classifyClones : String -> Maybe Reply
classifyClones text =
    if text == "CLONES: no clone clusters found" then
        Just ClonesNone

    else if String.startsWith "CLONES policy:" text || String.startsWith "CLONES network-wide:" text || String.startsWith "CLONES throttle:" text then
        Just (ClonesPolicy text)

    else if String.startsWith "CLONES: " text then
        Just (Said { section = Abuse, text = text })

    else
        case String.words text of
            [ "CLONES", kind, key, count, "clients)" ] ->
                if (kind == "ip" || kind == "net") && String.startsWith "(" count then
                    Maybe.map (\n -> ClonesHeader { kind = kind, key = key, count = n }) (String.toInt (String.dropLeft 1 count))

                else
                    Nothing

            _ ->
                Nothing


{-| `  nick ip account[ geo]` — an indented member line under a cluster
header. Not a `classify` pattern (it is only meaningful after a header,
so the console asks for it explicitly). -}
parseCloneMember : String -> Maybe CloneMember
parseCloneMember text =
    if String.startsWith "  " text then
        case String.words text of
            nick :: ip :: account :: _ ->
                Just { nick = nick, ip = ip, account = account }

            _ ->
                Nothing

    else
        Nothing


sessionRow : Bool -> List String -> Maybe Reply
sessionRow oper params =
    case params of
        [ _, _, "sessions", nick, ip, seconds, _, transport, account ] ->
            Just
                (SessionRow
                    { oper = oper
                    , nick = nick
                    , ip = unwrap ip
                    , seconds = Maybe.withDefault 0 (String.toInt seconds)
                    , tls = transport == "tls"
                    , account = account
                    }
                )

        _ ->
            Nothing


unwrap : String -> String
unwrap ip =
    if String.startsWith "(" ip && String.endsWith ")" ip then
        String.slice 1 -1 ip

    else
        ip



-- APPEALS


classifyAppeal : String -> Maybe Reply
classifyAppeal text =
    case text of
        "APPEAL none" ->
            Just AppealNone

        "APPEAL already filed" ->
            Just AppealAlready

        "APPEAL answered" ->
            Just AppealAnswered

        "APPEAL no such id" ->
            Just AppealNoSuchId

        "APPEAL could not file" ->
            Just (Said { section = Appeals, text = text })

        _ ->
            if String.startsWith "APPEAL filed " text then
                Maybe.map AppealFiled (String.toInt (String.dropLeft 13 text))

            else
                let
                    ( head, body ) =
                        splitReason text
                in
                case String.words head of
                    [ "APPEAL", id, nick, host, state ] ->
                        case ( String.toInt id, state ) of
                            ( Just n, "open" ) ->
                                Just (AppealRow { id = n, nick = nick, host = host, answered = False, text = body })

                            ( Just n, "answered" ) ->
                                Just (AppealRow { id = n, nick = nick, host = host, answered = True, text = body })

                            _ ->
                                Nothing

                    _ ->
                        Nothing



-- CONTENT


classifyFilter : String -> Maybe Reply
classifyFilter text =
    if String.startsWith "FILTER LIST #" text then
        case String.words (String.dropLeft 13 text) of
            index :: _ ->
                let
                    pattern =
                        String.trim (String.dropLeft (String.length index) (String.dropLeft 13 text))
                in
                Maybe.map (\n -> FilterRow { index = n, pattern = pattern }) (String.toInt index)

            [] ->
                Nothing

    else if String.startsWith "FILTER: End of filter list (" text then
        Maybe.map FilterEnd (String.toInt (String.filter Char.isDigit text))

    else if text == "FILTER: pattern added" then
        Just (FilterChanged { added = True })

    else if text == "FILTER: pattern removed" then
        Just (FilterChanged { added = False })

    else
        Nothing


classifySpamtrap : String -> Maybe Reply
classifySpamtrap text =
    if String.startsWith "SPAMTRAP: " text then
        case List.filterMap String.toInt (String.words text) of
            [ nicks, channels, offenders, trips ] ->
                Just (SpamtrapSummary { nicks = nicks, channels = channels, offenders = offenders, trips = trips })

            _ ->
                Just (Said { section = Content, text = text })

    else
        Just (Said { section = Content, text = text })


classifyHold : String -> Maybe Reply
classifyHold text =
    case String.words text of
        [ "HOLD", "released", n ] ->
            Maybe.map (\c -> HoldDone { released = True, count = c }) (String.toInt n)

        [ "HOLD", "dropped", n ] ->
            Maybe.map (\c -> HoldDone { released = False, count = c }) (String.toInt n)

        _ ->
            Just (Said { section = Content, text = text })


classifyPolicy : String -> Maybe Reply
classifyPolicy text =
    if String.startsWith "POLICY: ward=" text then
        let
            pair token =
                case String.split "=" token of
                    [ key, value ] ->
                        Maybe.map (Tuple.pair key) (String.toInt value)

                    _ ->
                        Nothing

            pairs =
                List.filterMap pair (String.words (String.dropLeft 8 text))

            get key =
                Maybe.withDefault 0 (List.head (List.filterMap (\( k, v ) -> if k == key then Just v else Nothing) pairs))
        in
        Just (PolicyGenerations { ward = get "ward", filter = get "filter", class = get "class", ban = get "ban" })

    else if String.startsWith "POLICY: rolled " text then
        Just (PolicyRolled text)

    else
        Just (Said { section = Content, text = text })



-- EVENT SPINE


eventCategories : String -> Reply
eventCategories text =
    let
        body =
            String.dropLeft (String.length "Event categories:") text

        ( listPart, severityPart ) =
            case String.split "(min severity:" body of
                [ before, after ] ->
                    ( before, String.trim (String.replace ")" "" after) )

                _ ->
                    ( body, "" )

        names =
            String.words listPart
                |> List.filter (\w -> w /= "(none)")
    in
    EventCategories { subscribed = names, minSeverity = severityPart }



-- STANDARD REPLIES


classifyFail : List String -> Maybe Reply
classifyFail params =
    case params of
        command :: code :: rest ->
            if List.member command [ "FILTER", "UNREJECT", "APPEAL", "WARD", "SHUN", "SPAMTRAP", "HOLD", "POLICY", "CHALLENGE", "QUARANTINE" ] then
                Just (Failed { command = command, code = code, text = lastParam rest })

            else
                Nothing

        _ ->
            Nothing



-- HELPERS


{-| Split `head :reason` at the first ` :` (the daemon writes the
reason after a literal ` :` inside the notice text). -}
splitReason : String -> ( String, String )
splitReason text =
    case String.indexes " :" text of
        i :: _ ->
            ( String.left i text, String.dropLeft (i + 2) text )

        [] ->
            ( text, "" )



-- PRESENTATION


sectionOf : Reply -> Section
sectionOf reply =
    case reply of
        WardRow _ ->
            Bans

        WardEnd ->
            Bans

        WardTested _ ->
            Bans

        LineTested _ ->
            Bans

        MaskTested _ ->
            Bans

        ShunRow _ ->
            Silence

        ShunEnd ->
            Silence

        GagSet _ ->
            Silence

        QuarantineMoved ->
            Silence

        AbuseFact _ ->
            Abuse

        AbuseNoNick ->
            Abuse

        ClonesPolicy _ ->
            Abuse

        ClonesHeader _ ->
            Abuse

        ClonesNone ->
            Abuse

        SessionRow _ ->
            Abuse

        SessionsEnd ->
            Abuse

        AppealRow _ ->
            Appeals

        AppealNone ->
            Appeals

        AppealFiled _ ->
            Appeals

        AppealAlready ->
            Appeals

        AppealAnswered ->
            Appeals

        AppealNoSuchId ->
            Appeals

        FilterRow _ ->
            Content

        FilterEnd _ ->
            Content

        FilterChanged _ ->
            Content

        SpamtrapSummary _ ->
            Content

        HoldDone _ ->
            Content

        PolicyGenerations _ ->
            Content

        PolicyRolled _ ->
            Content

        EventCategories _ ->
            Live

        EventSeverityIs _ ->
            Live

        EventStatsText _ ->
            Live

        PrivilegeList _ ->
            Network

        RehashDone _ ->
            Network

        Said s ->
            s.section

        Denied _ ->
            Network

        NeedParams _ ->
            Network

        NoSuchNick _ ->
            Network

        Failed f ->
            case f.command of
                "FILTER" ->
                    Content

                "SPAMTRAP" ->
                    Content

                "HOLD" ->
                    Content

                "POLICY" ->
                    Content

                "CHALLENGE" ->
                    Content

                "APPEAL" ->
                    Appeals

                "WARD" ->
                    Bans

                "SHUN" ->
                    Silence

                "QUARANTINE" ->
                    Silence

                _ ->
                    Network


toneOf : Reply -> Tone
toneOf reply =
    case reply of
        WardTested t ->
            if t.matched then
                Warn

            else
                Plain

        LineTested t ->
            if t.matchedBy == Nothing then
                Plain

            else
                Warn

        GagSet _ ->
            Good

        QuarantineMoved ->
            Good

        AbuseNoNick ->
            Bad

        AppealFiled _ ->
            Good

        AppealAlready ->
            Warn

        AppealAnswered ->
            Good

        AppealNoSuchId ->
            Bad

        FilterChanged _ ->
            Good

        HoldDone _ ->
            Good

        PolicyRolled _ ->
            Good

        RehashDone _ ->
            Good

        Denied _ ->
            Bad

        NeedParams _ ->
            Bad

        NoSuchNick _ ->
            Bad

        Failed _ ->
            Bad

        Said s ->
            if looksLikeProblem s.text then
                Warn

            else
                Plain

        _ ->
            Plain


looksLikeProblem : String -> Bool
looksLikeProblem text =
    let
        lower =
            String.toLower text
    in
    List.any (\needle -> String.contains needle lower)
        [ "could not", "too broad", "unknown", "usage:", "failed", "denied", "no such", "not found", "disabled", "invalid" ]


{-| One plain sentence per reply, for the desk's reply log. -}
describe : Reply -> String
describe reply =
    case reply of
        WardRow w ->
            "Ward " ++ w.match ++ " " ++ w.pattern ++ " (" ++ w.scope ++ ", " ++ w.action ++ ") set by " ++ w.setBy ++ reasonSuffix w.reason

        WardEnd ->
            "End of the ward list."

        WardTested t ->
            if t.matched then
                "Matches the ward " ++ t.text

            else
                t.text

        LineTested t ->
            case t.matchedBy of

                Just m ->
                    t.target ++ " is covered by the " ++ m.match ++ " ban " ++ m.pattern ++ reasonSuffix m.reason

                Nothing ->
                    t.target ++ " matches no ban."

        MaskTested t ->
            t.mask ++ " matches " ++ String.fromInt t.count ++ " connected " ++ plural t.count "client" "clients" ++ "."

        ShunRow s ->
            "Shun " ++ s.mask ++ " set by " ++ s.setBy ++ reasonSuffix s.reason

        ShunEnd ->
            "End of the shun list."

        GagSet g ->
            if g.on then
                g.nick ++ " is gagged."

            else
                g.nick ++ " is no longer gagged."

        QuarantineMoved ->
            "Moved to the quarantine room."

        AbuseFact f ->
            f.nick ++ " · " ++ f.topic ++ " " ++ f.detail

        AbuseNoNick ->
            "No one is online with that nick."

        ClonesPolicy text ->
            text

        ClonesHeader c ->
            "Clone group " ++ c.key ++ " (" ++ String.fromInt c.count ++ " connections)"

        ClonesNone ->
            "No clone groups found."

        SessionRow s ->
            s.nick ++ " from " ++ s.ip

        SessionsEnd ->
            "End of the session list."

        AppealRow a ->
            "Appeal " ++ String.fromInt a.id ++ " from " ++ a.nick

        AppealNone ->
            "No appeals have been filed."

        AppealFiled id ->
            "Appeal " ++ String.fromInt id ++ " filed."

        AppealAlready ->
            "An appeal from this connection is already on file for this hour."

        AppealAnswered ->
            "Answer recorded."

        AppealNoSuchId ->
            "No appeal has that number."

        FilterRow f ->
            "Filter " ++ String.fromInt f.index ++ ": " ++ f.pattern

        FilterEnd n ->
            "End of the filter list (" ++ String.fromInt n ++ ")."

        FilterChanged c ->
            if c.added then
                "Filter pattern added."

            else
                "Filter pattern removed."

        SpamtrapSummary s ->
            String.fromInt s.nicks ++ " trap " ++ plural s.nicks "nick" "nicks" ++ ", " ++ String.fromInt s.channels ++ " trap " ++ plural s.channels "channel" "channels" ++ ", " ++ String.fromInt s.offenders ++ " flagged, " ++ String.fromInt s.trips ++ " total " ++ plural s.trips "trip" "trips" ++ "."

        HoldDone h ->
            String.fromInt h.count
                ++ (if h.released then
                        " held " ++ plural h.count "message" "messages" ++ " released."

                    else
                        " held " ++ plural h.count "message" "messages" ++ " dropped."
                   )

        PolicyGenerations p ->
            "Policy generations — wards " ++ String.fromInt p.ward ++ ", filters " ++ String.fromInt p.filter ++ ", classes " ++ String.fromInt p.class ++ ", bans " ++ String.fromInt p.ban ++ "."

        PolicyRolled text ->
            String.dropLeft 8 text

        EventCategories e ->
            if List.isEmpty e.subscribed then
                "Following no categories."

            else
                "Following " ++ String.join ", " e.subscribed ++ "."

        EventSeverityIs text ->
            text

        EventStatsText text ->
            String.trim text

        PrivilegeList p ->
            "Your class is " ++ p.class ++ " with " ++ String.fromInt (List.length p.privileges) ++ " privileges."

        RehashDone text ->
            text

        Denied text ->
            text

        NeedParams n ->
            n.command ++ ": " ++ n.text

        NoSuchNick nick ->
            "No such nick: " ++ nick

        Failed f ->
            f.command ++ " failed (" ++ f.code ++ "): " ++ f.text

        Said s ->
            s.text


reasonSuffix : String -> String
reasonSuffix reason =
    if reason == "" then
        ""

    else
        " — " ++ reason


plural : Int -> String -> String -> String
plural n one many =
    if n == 1 then
        one

    else
        many

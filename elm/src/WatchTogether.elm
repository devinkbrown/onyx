module WatchTogether exposing
    ( Action(..)
    , Activity
    , Anchor
    , Clock
    , Ctx
    , EditStep(..)
    , Editor
    , Effect(..)
    , Field(..)
    , Model
    , Msg(..)
    , Notice
    , Pending
    , PlayState(..)
    , Rev
    , Tone(..)
    , UrlProblem(..)
    , accept
    , anchorFor
    , blank
    , canEnd
    , canStart
    , cancelHandoff
    , checkUrl
    , claim
    , clockFor
    , context
    , defaultTitle
    , driftToleranceSeconds
    , encode
    , finished
    , formatClock
    , handoffTargets
    , hostPresent
    , isHost
    , isParticipant
    , join
    , joinBlocked
    , leave
    , maxNickLength
    , maxParseLength
    , maxParticipants
    , maxSeconds
    , maxTitleLength
    , maxUrlLength
    , normalize
    , normalizeNick
    , offer
    , parse
    , parseDuration
    , pause
    , pendingFor
    , pendingTimeoutMs
    , play
    , positionAt
    , propKey
    , rawIn
    , reconcile
    , rosterEntries
    , seek
    , serialize
    , settleLine
    , settleRoom
    , settleTick
    , start
    , startReserve
    , stateLabel
    , update
    , urlHost
    , wireBudget
    , withAnchor
    )

{-| v3/gap-watch — Watch Together over the IRCX channel property
`ocean.watch` (wire format shared with the SolidJS client's
`watchTogether.ts`; English subsystem name, legacy `ocean.` wire key).

What it is, honestly: a shared **timeline and link**, not a media
relay. A room operator publishes a title, an optional http(s) link, a
play/pause state and a position; everyone in the room sees the same
clock tick locally and opens the link themselves. Onyx never streams,
embeds or controls the video.

Protocol truth (Onyx Server, `proto/ircx_prop_store.zig` +
`daemon/server.zig handleProp`):

  - `PROP <#room> ocean.watch :<value>` sets; an empty trailing value
    deletes. Keys are case-insensitive on the server.
  - Only channel operators (op / owner / founder, or an IRC oper) may
    set or delete a custom channel property; everyone else gets
    `913 ERR_NOACCESS`. So joining, leaving and accepting host are
    operator actions too — the UI says so instead of failing.
  - Values are capped at **512 bytes** (`MAX_PROP_VALUE`); a longer
    value is refused with `461 … PROP :Invalid PROP`. The SolidJS
    client budgeted 4096 and could publish values the server refuses;
    this module budgets 512.
  - The setter gets `818` (the stored row) + `819`; a delete gets only
    `819`. Every other IRCX member of the room gets
    `:<setter> PROP <#room> ocean.watch :<value>`.

Fixes over the SolidJS oracle (documented in the tests):

  - wire budget 512, not 4096;
  - an `at=<unix ms>` anchor is published with a playing position, so
    late joiners compute the same clock instead of anchoring at receipt
    (the oracle drifted by however long ago the last publish was).
    Unknown keys are ignored by the oracle parser, so this is
    backward compatible; values without `at` still anchor at receipt;
  - over-long nicks and URLs are rejected, never truncated into a
    different identity or resource;
  - a delete applies locally on the setter's `819` (the oracle waited
    for a `PROP` echo the server never sends to the setter).

-}

import Dict exposing (Dict)
import Modes
import Regex
import Set exposing (Set)
import Url
import Wire



-- ── constants ──────────────────────────────────────────────────────────


{-| The IRCX channel property carrying the activity (wire format). -}
propKey : String
propKey =
    "ocean.watch"


{-| Onyx Server's per-value cap (`ircx.MAX_PROP_VALUE`). -}
wireBudget : Int
wireBudget =
    512


{-| Parse work bound (the oracle's `WATCH_PROP_MAX_LENGTH`): anything
longer is rejected outright rather than truncated at a separator. -}
maxParseLength : Int
maxParseLength =
    4096


maxTitleLength : Int
maxTitleLength =
    160


maxUrlLength : Int
maxUrlLength =
    2048


maxNickLength : Int
maxNickLength =
    64


maxParticipants : Int
maxParticipants =
    128


{-| 366 days, the oracle's `WATCH_SECONDS_MAX`. -}
maxSeconds : Int
maxSeconds =
    366 * 24 * 60 * 60


{-| Latest accepted `at` anchor (2100-01-01T00:00:00Z). -}
maxAtMs : Int
maxAtMs =
    4102444800000


{-| A republished timeline within this many seconds of the clock we
are already showing keeps the local anchor, so the display never
jitters by a second when someone joins mid-play. -}
driftToleranceSeconds : Int
driftToleranceSeconds =
    2


{-| A remote `at` further ahead of our clock than this is a skewed
clock: anchor at receipt instead of freezing the position. -}
skewToleranceMs : Float
skewToleranceMs =
    5000


{-| Bytes a freshly started activity keeps free for what playback adds
later (`state=playing`, a longer position, the `at` anchor, a handoff
target and a few participants), so the link is never the casualty. -}
startReserve : Int
startReserve =
    96


pendingTimeoutMs : Float
pendingTimeoutMs =
    10000


defaultTitle : String
defaultTitle =
    "Watch together"



-- ── activity ───────────────────────────────────────────────────────────


type PlayState
    = Playing
    | Paused
    | Seeking
    | Handoff
    | Idle


type alias Activity =
    { title : String
    , url : Maybe String
    , host : Maybe String
    , state : PlayState
    , position : Maybe Int
    , duration : Maybe Int
    , at : Maybe Int
    , participants : List String
    , handoffTo : Maybe String
    }


stateToken : PlayState -> String
stateToken state =
    case state of
        Playing ->
            "playing"

        Paused ->
            "paused"

        Seeking ->
            "seeking"

        Handoff ->
            "handoff"

        Idle ->
            "idle"


parseState : String -> PlayState
parseState raw =
    case String.toLower (String.trim raw) of
        "playing" ->
            Playing

        "paused" ->
            Paused

        "seeking" ->
            Seeking

        "handoff" ->
            Handoff

        _ ->
            Idle



-- ── text hygiene ───────────────────────────────────────────────────────


{-| Replace lone UTF-16 surrogates with U+FFFD (the oracle's
`toWellFormed`), so `encodeURIComponent` can never throw. -}
wellFormed : String -> String
wellFormed s =
    if String.any isBrokenChar s then
        String.map
            (\c ->
                if isBrokenChar c then
                    '\u{FFFD}'

                else
                    c
            )
            s

    else
        s


isBrokenChar : Char -> Bool
isBrokenChar c =
    let
        code =
            Char.toCode c
    in
    (code >= 0xD800 && code <= 0xDFFF)
        || (code /= code)
        || String.fromChar (Char.fromCode code) /= String.fromChar c


{-| Longest prefix of at most `n` UTF-16 units that never splits a
surrogate pair. -}
sliceBounded : Int -> String -> String
sliceBounded n s =
    if String.length s <= n then
        s

    else
        String.foldl
            (\c ( acc, used, open ) ->
                let
                    w =
                        String.length (String.fromChar c)
                in
                if open && used + w <= n then
                    ( c :: acc, used + w, True )

                else
                    ( acc, used, False )
            )
            ( [], 0, True )
            s
            |> (\( acc, _, _ ) -> String.fromList (List.reverse acc))


{-| Trim, make well formed, drop empties, bound by slicing (titles). -}
clean : Int -> String -> Maybe String
clean n raw =
    let
        t =
            String.trim (wellFormed raw)
    in
    if String.isEmpty t then
        Nothing

    else
        Just (sliceBounded n t)


isControl : Char -> Bool
isControl c =
    let
        code =
            Char.toCode c
    in
    code <= 0x1F || (code >= 0x7F && code <= 0x9F)


{-| JavaScript `\s` (the oracle's nick test). -}
isJsSpace : Char -> Bool
isJsSpace c =
    let
        code =
            Char.toCode c
    in
    (code >= 0x09 && code <= 0x0D)
        || (code == 0x20)
        || (code == 0xA0)
        || (code == 0x1680)
        || (code >= 0x2000 && code <= 0x200A)
        || (code == 0x2028)
        || (code == 0x2029)
        || (code == 0x202F)
        || (code == 0x205F)
        || (code == 0x3000)
        || (code == 0xFEFF)


{-| A display title: controls become spaces, then trim and bound. -}
cleanTitle : String -> Maybe String
cleanTitle raw =
    clean maxTitleLength
        (String.map
            (\c ->
                if isControl c then
                    ' '

                else
                    c
            )
            raw
        )


{-| Validate a nick without truncating it into somebody else: empty,
over-long, whitespace, control or comma (a roster separator) → Nothing.
-}
normalizeNick : String -> Maybe String
normalizeNick raw =
    let
        t =
            String.trim (wellFormed raw)
    in
    if String.isEmpty t || String.length t > maxNickLength then
        Nothing

    else if String.any (\c -> isControl c || isJsSpace c || c == ',') t then
        Nothing

    else
        Just t


sameNick : Maybe String -> Maybe String -> Bool
sameNick a b =
    case ( a, b ) of
        ( Just x, Just y ) ->
            String.toLower x == String.toLower y

        _ ->
            False


lower : String -> String
lower =
    String.toLower


normalizeSeconds : Maybe Int -> Maybe Int
normalizeSeconds value =
    case value of
        Just n ->
            if n >= 0 && n <= maxSeconds then
                Just n

            else
                Nothing

        Nothing ->
            Nothing


parseSeconds : String -> Maybe Int
parseSeconds raw =
    case String.toFloat (String.trim raw) of
        Just f ->
            if isNaN f || isInfinite f || f < 0 || f > toFloat maxSeconds then
                Nothing

            else
                Just (floor f)

        Nothing ->
            Nothing


parseAt : String -> Maybe Int
parseAt raw =
    let
        t =
            String.trim raw
    in
    if String.isEmpty t || String.length t > 13 || not (String.all Char.isDigit t) then
        Nothing

    else
        String.toInt t |> Maybe.andThen normalizeAt


normalizeAt : Int -> Maybe Int
normalizeAt n =
    if n > 0 && n <= maxAtMs then
        Just n

    else
        Nothing



-- ── links ──────────────────────────────────────────────────────────────


type UrlProblem
    = UrlEmpty
    | UrlTooLong
    | UrlScheme
    | UrlCharacters
    | UrlCredentials
    | UrlNonAsciiHost
    | UrlBadHost


{-| Untrusted link gate: http(s) only, no whitespace / control /
backslash (browsers read `\` as `/` in http URLs), no `user:pass@`
(the classic `https://real.example@evil.example` trick), an ASCII host
(punycode for IDNs, so a look-alike cannot hide), a valid port, and
`elm/url` must agree it parses. The link is returned exactly as given.
-}
checkUrl : String -> Result UrlProblem String
checkUrl raw =
    let
        t =
            String.trim (wellFormed raw)

        lowered =
            String.toLower t

        rest =
            if String.startsWith "https://" lowered then
                Just ( "https://", String.dropLeft 8 t )

            else if String.startsWith "http://" lowered then
                Just ( "http://", String.dropLeft 7 t )

            else
                Nothing
    in
    if String.isEmpty t then
        Err UrlEmpty

    else if String.length t > maxUrlLength then
        Err UrlTooLong

    else
        case rest of
            Nothing ->
                Err UrlScheme

            Just ( scheme, afterScheme ) ->
                if String.any (\c -> isControl c || isJsSpace c || c == '\\') t then
                    Err UrlCharacters

                else
                    let
                        authority =
                            takeUntilAny [ '/', '?', '#' ] afterScheme
                    in
                    if String.contains "@" authority then
                        Err UrlCredentials

                    else
                        case splitHostPort authority of
                            Nothing ->
                                Err UrlBadHost

                            Just ( host, _ ) ->
                                if String.any (\c -> Char.toCode c > 0x7E) host then
                                    Err UrlNonAsciiHost

                                else if not (validHost host) then
                                    Err UrlBadHost

                                else
                                    case Url.fromString (scheme ++ afterScheme) of
                                        Just _ ->
                                            Ok t

                                        Nothing ->
                                            Err UrlBadHost


takeUntilAny : List Char -> String -> String
takeUntilAny stops s =
    String.foldl
        (\c ( acc, open ) ->
            if open && not (List.member c stops) then
                ( c :: acc, True )

            else
                ( acc, False )
        )
        ( [], True )
        s
        |> Tuple.first
        |> List.reverse
        |> String.fromList


{-| `host[:port]` or `[v6][:port]` → (host, port). -}
splitHostPort : String -> Maybe ( String, Maybe Int )
splitHostPort authority =
    let
        portOf p =
            if String.isEmpty p then
                Just Nothing

            else if String.length p <= 5 && String.all Char.isDigit p then
                case String.toInt p of
                    Just n ->
                        if n <= 65535 then
                            Just (Just n)

                        else
                            Nothing

                    Nothing ->
                        Nothing

            else
                Nothing
    in
    if String.startsWith "[" authority then
        case String.indexes "]" authority of
            close :: _ ->
                let
                    host =
                        String.left (close + 1) authority

                    after =
                        String.dropLeft (close + 1) authority
                in
                if String.isEmpty after then
                    Just ( host, Nothing )

                else if String.startsWith ":" after then
                    portOf (String.dropLeft 1 after) |> Maybe.map (\p -> ( host, p ))

                else
                    Nothing

            [] ->
                Nothing

    else
        case String.split ":" authority of
            [ host ] ->
                Just ( host, Nothing )

            [ host, p ] ->
                portOf p |> Maybe.map (\pn -> ( host, pn ))

            _ ->
                Nothing


validHost : String -> Bool
validHost host =
    if String.startsWith "[" host then
        String.length host > 2
            && String.all (\c -> Char.isHexDigit c || c == ':' || c == '.' || c == '[' || c == ']') host

    else
        not (String.isEmpty host)
            && String.length host <= 253
            && String.all (\c -> Char.isAlphaNum c || c == '-' || c == '.' || c == '_') host
            && not (String.startsWith "." host)
            && not (String.contains ".." host)
            && String.any Char.isAlphaNum host


normalizeUrl : String -> Maybe String
normalizeUrl raw =
    Result.toMaybe (checkUrl raw)


{-| The host a link opens, lowercased (with a non-default port), for
showing people where "Open" goes before they press it. -}
urlHost : String -> Maybe String
urlHost raw =
    case checkUrl raw of
        Ok t ->
            let
                lowered =
                    String.toLower t

                afterScheme =
                    if String.startsWith "https://" lowered then
                        String.dropLeft 8 lowered

                    else
                        String.dropLeft 7 lowered
            in
            Just (takeUntilAny [ '/', '?', '#' ] afterScheme)

        Err _ ->
            Nothing



-- ── wire codec ─────────────────────────────────────────────────────────


{-| `application/x-www-form-urlencoded` exactly as `URLSearchParams`
writes it (alnum and `*-._` raw, space → `+`, everything else `%XX`
over UTF-8) — byte-identical to the oracle serializer. -}
formEncode : String -> String
formEncode raw =
    Url.percentEncode (wellFormed raw)
        |> String.replace "%20" "+"
        |> String.replace "!" "%21"
        |> String.replace "'" "%27"
        |> String.replace "(" "%28"
        |> String.replace ")" "%29"
        |> String.replace "~" "%7E"


{-| Lenient decode: `+` → space, then percent-decoding; a malformed
escape keeps the text as written (it can only ever be shown). -}
formDecode : String -> String
formDecode raw =
    let
        spaced =
            String.replace "+" " " raw
    in
    Maybe.withDefault spaced (Url.percentDecode spaced)


parsePairs : String -> List ( String, String )
parsePairs source =
    let
        body =
            if String.startsWith "?" source then
                String.dropLeft 1 source

            else
                source
    in
    body
        |> String.replace ";" "&"
        |> String.split "&"
        |> List.filter (not << String.isEmpty)
        |> List.map
            (\seg ->
                case String.indexes "=" seg of
                    i :: _ ->
                        ( formDecode (String.left i seg), formDecode (String.dropLeft (i + 1) seg) )

                    [] ->
                        ( formDecode seg, "" )
            )


firstValue : String -> List ( String, String ) -> Maybe String
firstValue key pairs =
    case pairs of
        [] ->
            Nothing

        ( k, v ) :: rest ->
            if k == key then
                Just v

            else
                firstValue key rest


{-| Read an `ocean.watch` value. Oversized values are rejected (never
truncated); a value with neither title nor link is no activity.
-}
parse : String -> Maybe Activity
parse raw =
    if String.length raw > maxParseLength then
        Nothing

    else
        case clean maxParseLength raw of
            Nothing ->
                Nothing

            Just source ->
                let
                    pairs =
                        parsePairs source

                    get k =
                        firstValue k pairs

                    nonEmpty v =
                        if String.isEmpty (String.trim v) then
                            Nothing

                        else
                            Just v

                    title =
                        get "title" |> Maybe.andThen nonEmpty

                    url =
                        get "url" |> Maybe.andThen nonEmpty
                in
                if title == Nothing && url == Nothing then
                    Nothing

                else
                    Just
                        (normalize
                            { title = Maybe.withDefault "" title
                            , url = url
                            , host = get "host"
                            , state = parseState (Maybe.withDefault "" (get "state"))
                            , position = get "position" |> Maybe.andThen parseSeconds
                            , duration = get "duration" |> Maybe.andThen parseSeconds
                            , at = get "at" |> Maybe.andThen parseAt
                            , participants =
                                get "participants"
                                    |> Maybe.map (String.split ",")
                                    |> Maybe.withDefault []
                            , handoffTo = get "handoff"
                            }
                        )


{-| Encode without normalizing (field order matches the oracle;
`at` sits after `duration` and only accompanies a playing position). -}
encode : Activity -> String
encode a =
    let
        opt key value =
            case value of
                Just v ->
                    [ ( key, v ) ]

                Nothing ->
                    []
    in
    ([ ( "title", a.title ) ]
        ++ opt "url" a.url
        ++ opt "host" a.host
        ++ [ ( "state", stateToken a.state ) ]
        ++ opt "position" (Maybe.map String.fromInt a.position)
        ++ opt "duration" (Maybe.map String.fromInt a.duration)
        ++ opt "at" (Maybe.map String.fromInt a.at)
        ++ (if List.isEmpty a.participants then
                []

            else
                [ ( "participants", String.join "," a.participants ) ]
           )
        ++ opt "handoff" a.handoffTo
    )
        |> List.map (\( k, v ) -> formEncode k ++ "=" ++ formEncode v)
        |> String.join "&"


{-| Normalize, then encode — what goes on the wire. -}
serialize : Activity -> String
serialize a =
    encode (normalize a)


{-| The one normalizer for parsed and locally built activities. -}
normalize : Activity -> Activity
normalize a =
    let
        url =
            Maybe.andThen normalizeUrl a.url

        host =
            Maybe.andThen normalizeNick a.host

        pendingTarget =
            if a.state == Handoff then
                Maybe.andThen normalizeNick a.handoffTo

            else
                Nothing

        participants =
            normalizeRoster a.participants host pendingTarget

        member nick =
            case nick of
                Just n ->
                    List.any (\p -> lower p == lower n) participants

                Nothing ->
                    False

        ( state, handoffTo ) =
            if a.state == Handoff then
                if host /= Nothing && pendingTarget /= Nothing && not (sameNick host pendingTarget) && member host && member pendingTarget then
                    ( Handoff, pendingTarget )

                else
                    ( Paused, Nothing )

            else
                ( a.state, Nothing )

        duration =
            normalizeSeconds a.duration

        position =
            case ( normalizeSeconds a.position, duration ) of
                ( Just p, Just d ) ->
                    Just (min p d)

                ( p, _ ) ->
                    p

        title =
            case cleanTitle a.title of
                Just t ->
                    t

                Nothing ->
                    url |> Maybe.andThen (clean maxTitleLength) |> Maybe.withDefault defaultTitle
    in
    trimToBudget
        { title = title
        , url = url
        , host = host
        , state = state
        , position = position
        , duration = duration
        , at =
            if state == Playing then
                Maybe.andThen normalizeAt a.at

            else
                Nothing
        , participants = participants
        , handoffTo = handoffTo
        }


{-| Dedupe case-insensitively and cap at 128; the host and a pending
handoff target are authority-bearing, so past the cap they replace the
last ordinary entry (the oracle's roster rule).
-}
normalizeRoster : List String -> Maybe String -> Maybe String -> List String
normalizeRoster raw host pendingTarget =
    let
        reserved =
            List.filterMap identity [ host, pendingTarget ] |> List.map lower

        deduped =
            List.foldl
                (\nick ( acc, keys ) ->
                    case normalizeNick nick of
                        Just n ->
                            if Set.member (lower n) keys then
                                ( acc, keys )

                            else
                                ( n :: acc, Set.insert (lower n) keys )

                        Nothing ->
                            ( acc, keys )
                )
                ( [], Set.empty )
                raw
                |> Tuple.first
                |> List.reverse

        kept =
            List.take maxParticipants deduped

        late =
            List.drop maxParticipants deduped
                |> List.filter (\n -> List.member (lower n) reserved)
    in
    List.foldl (replaceLastOrdinary reserved) kept late


lastOrdinaryIndex : List String -> List String -> Maybe Int
lastOrdinaryIndex reserved roster =
    roster
        |> List.indexedMap Tuple.pair
        |> List.filter (\( _, n ) -> not (List.member (lower n) reserved))
        |> List.reverse
        |> List.head
        |> Maybe.map Tuple.first


replaceLastOrdinary : List String -> String -> List String -> List String
replaceLastOrdinary reserved nick roster =
    case lastOrdinaryIndex reserved roster of
        Just i ->
            List.indexedMap
                (\j n ->
                    if j == i then
                        nick

                    else
                        n
                )
                roster

        Nothing ->
            roster


fits : Activity -> Bool
fits a =
    String.length (encode a) <= wireBudget


{-| Fit the 512-byte server budget: drop ordinary participants from the
end, then the link (never truncated into another resource), then
shorten the title; the last resort is a bare paused default. -}
trimToBudget : Activity -> Activity
trimToBudget a =
    if fits a then
        a

    else
        let
            reserved =
                List.filterMap identity
                    [ a.host
                    , if a.state == Handoff then
                        a.handoffTo

                      else
                        Nothing
                    ]
                    |> List.map lower

            shrinkRoster act =
                if fits act then
                    act

                else
                    case lastOrdinaryIndex reserved act.participants of
                        Just i ->
                            shrinkRoster { act | participants = List.take i act.participants ++ List.drop (i + 1) act.participants }

                        Nothing ->
                            act

            rostered =
                shrinkRoster a

            unlinked =
                if fits rostered then
                    rostered

                else
                    { rostered | url = Nothing }

            shrinkTitle act =
                if fits act || String.length act.title <= 1 then
                    act

                else
                    shrinkTitle { act | title = sliceBounded (String.length act.title - 1) act.title }

            titled =
                shrinkTitle unlinked
        in
        if fits titled then
            titled

        else
            { title = defaultTitle
            , url = Nothing
            , host = Nothing
            , state = Paused
            , position = Nothing
            , duration = Nothing
            , at = Nothing
            , participants = []
            , handoffTo = Nothing
            }



-- ── clock ──────────────────────────────────────────────────────────────


{-| Where the shared clock was true: `position` seconds at local
`anchorMs`. Recorded when a value is first seen. -}
type alias Anchor =
    { raw : String
    , position : Int
    , anchorMs : Float
    , playing : Bool
    }


freshAnchor : Float -> String -> Activity -> Anchor
freshAnchor nowMs raw a =
    let
        anchorMs =
            case a.at of
                Just at ->
                    if toFloat at > nowMs + skewToleranceMs then
                        nowMs

                    else
                        toFloat at

                Nothing ->
                    nowMs
    in
    { raw = raw, position = Maybe.withDefault 0 a.position, anchorMs = anchorMs, playing = a.state == Playing }


{-| Anchor a newly seen value. A playing republish within
`driftToleranceSeconds` of the clock already shown keeps the old
anchor (no visible jitter); anything else re-anchors. -}
anchorFor : Float -> Maybe Anchor -> String -> Activity -> Anchor
anchorFor nowMs previous raw a =
    let
        candidate =
            freshAnchor nowMs raw a
    in
    case previous of
        Just prev ->
            if prev.raw == raw then
                prev

            else if
                prev.playing
                    && candidate.playing
                    && abs (rawPosition nowMs prev a.duration - rawPosition nowMs candidate a.duration) <= driftToleranceSeconds
            then
                { prev | raw = raw }

            else
                candidate

        Nothing ->
            candidate


rawPosition : Float -> Anchor -> Maybe Int -> Int
rawPosition nowMs anchor duration =
    let
        elapsed =
            if anchor.playing then
                max 0 (floor ((nowMs - anchor.anchorMs) / 1000))

            else
                0

        p =
            min maxSeconds (anchor.position + elapsed)
    in
    case duration of
        Just d ->
            min p d

        Nothing ->
            p


{-| The clock now. Paused / handoff positions stand still; playing
advances from the anchor and stops at the duration. -}
positionAt : Float -> Anchor -> Activity -> Maybe Int
positionAt nowMs anchor a =
    if a.state == Playing then
        Just (rawPosition nowMs { anchor | playing = True } a.duration)

    else
        Maybe.map
            (\p ->
                case a.duration of
                    Just d ->
                        min p d

                    Nothing ->
                        p
            )
            a.position


{-| A playing activity that has reached its duration. -}
finished : Float -> Anchor -> Activity -> Bool
finished nowMs anchor a =
    case ( a.state, a.duration ) of
        ( Playing, Just d ) ->
            positionAt nowMs anchor a == Just d

        _ ->
            False


type alias Clock =
    { nowMs : Float, anchor : Anchor }


{-| The anchor to use for a value (recorded, else a fresh one). -}
clockFor : Float -> Dict String Anchor -> String -> String -> Activity -> Clock
clockFor nowMs anchors channel raw a =
    case Dict.get (lower channel) anchors of
        Just anchor ->
            if anchor.raw == raw then
                { nowMs = nowMs, anchor = anchor }

            else
                { nowMs = nowMs, anchor = freshAnchor nowMs raw a }

        Nothing ->
            { nowMs = nowMs, anchor = freshAnchor nowMs raw a }


current : Clock -> Activity -> Int
current clock a =
    Maybe.withDefault 0 (positionAt clock.nowMs clock.anchor a)


{-| Keep the timeline exactly as shown when republishing for a roster
change: a playing value carries the anchor it is being shown from. -}
withAnchor : Clock -> Activity -> Activity
withAnchor clock a =
    if a.state == Playing then
        { a | position = Just clock.anchor.position, at = Just (round clock.anchor.anchorMs) }

    else
        a


nowInt : Clock -> Int
nowInt clock =
    round clock.nowMs



-- ── roles ──────────────────────────────────────────────────────────────


isHost : String -> Activity -> Bool
isHost self a =
    sameNick a.host (Just self)


isParticipant : String -> Activity -> Bool
isParticipant self a =
    List.any (\p -> lower p == lower self) a.participants


{-| Participants who could take over hosting: not the host, and a room
operator (accepting writes the property, which only operators may). -}
handoffTargets : (String -> Bool) -> Activity -> List String
handoffTargets isOperator a =
    List.filter (\p -> not (sameNick (Just p) a.host) && isOperator p) a.participants


{-| Roster rows with their role words. -}
rosterEntries : Maybe String -> Activity -> List { nick : String, labels : List String }
rosterEntries self a =
    List.map
        (\nick ->
            { nick = nick
            , labels =
                List.filterMap identity
                    [ if sameNick (Just nick) a.host then
                        Just "Host"

                      else
                        Nothing
                    , if a.state == Handoff && sameNick (Just nick) a.handoffTo then
                        Just "Pending host"

                      else
                        Nothing
                    , if sameNick (Just nick) self then
                        Just "You"

                      else
                        Nothing
                    ]
            }
        )
        a.participants



-- ── transitions ────────────────────────────────────────────────────────


{-| A new activity: paused at 0 with the host as its only participant. -}
start : { host : String, title : String, url : Maybe String, duration : Maybe Int } -> Activity
start opts =
    normalize
        { title = opts.title
        , url = opts.url
        , host = Just opts.host
        , state = Paused
        , position = Just 0
        , duration = opts.duration
        , at = Nothing
        , participants = [ opts.host ]
        , handoffTo = Nothing
        }


{-| Host: play from the shown position (from the top when finished). -}
play : Clock -> String -> Activity -> Maybe Activity
play clock self a =
    if not (isHost self a) || a.state == Playing || a.state == Handoff then
        Nothing

    else
        let
            pos =
                current clock a

            from =
                case a.duration of
                    Just d ->
                        if pos >= d then
                            0

                        else
                            pos

                    Nothing ->
                        pos
        in
        Just (normalize { a | state = Playing, position = Just from, at = Just (nowInt clock), handoffTo = Nothing })


{-| Host: freeze at the shown position (a finished value pauses at
its end). -}
pause : Clock -> String -> Activity -> Maybe Activity
pause clock self a =
    if not (isHost self a) || a.state /= Playing then
        Nothing

    else
        Just (normalize { a | state = Paused, position = Just (current clock a), at = Nothing })


{-| Host: jump, keeping play / pause. -}
seek : Clock -> String -> Int -> Activity -> Maybe Activity
seek clock self target a =
    if not (isHost self a) || a.state == Handoff then
        Nothing

    else
        let
            bounded =
                clamp 0 (Maybe.withDefault maxSeconds a.duration) target
        in
        if bounded == current clock a then
            Nothing

        else
            Just
                (normalize
                    { a
                        | position = Just bounded
                        , at =
                            if a.state == Playing then
                                Just (nowInt clock)

                            else
                                Nothing
                    }
                )


{-| Join the roster; Nothing when already in, at 128, or when the
512-byte budget would drop the new name (activity full). -}
join : Clock -> String -> Activity -> Maybe Activity
join clock self a =
    case normalizeNick self of
        Nothing ->
            Nothing

        Just nick ->
            if isParticipant nick a || List.length a.participants >= maxParticipants then
                Nothing

            else
                let
                    next =
                        normalize (withAnchor clock { a | participants = a.participants ++ [ nick ] })
                in
                if isParticipant nick next then
                    Just next

                else
                    Nothing


{-| True when joining is impossible because the activity is full. -}
joinBlocked : Clock -> String -> Activity -> Bool
joinBlocked clock self a =
    not (isParticipant self a) && join clock self a == Nothing


{-| Leave the roster. The host cannot (that would orphan the controls;
hand off first). A pending target leaving cancels the offer. -}
leave : Clock -> String -> Activity -> Maybe Activity
leave clock self a =
    if not (isParticipant self a) || isHost self a then
        Nothing

    else
        let
            target =
                a.state == Handoff && sameNick a.handoffTo (Just self)
        in
        Just
            (normalize
                (withAnchor clock
                    { a
                        | participants = List.filter (\p -> lower p /= lower self) a.participants
                        , state =
                            if target then
                                Paused

                            else
                                a.state
                        , handoffTo =
                            if target then
                                Nothing

                            else
                                a.handoffTo
                    }
                )
            )


{-| Host: offer hosting to a participant; playback freezes until they
accept or the host cancels. -}
offer : Clock -> String -> String -> Activity -> Maybe Activity
offer clock self targetNick a =
    case normalizeNick targetNick of
        Nothing ->
            Nothing

        Just target ->
            if not (isHost self a) || a.state == Handoff || sameNick (Just target) a.host || not (isParticipant target a) then
                Nothing

            else
                Just (normalize { a | state = Handoff, handoffTo = Just target, position = Just (current clock a), at = Nothing })


{-| Host: withdraw a pending offer, staying paused. -}
cancelHandoff : Clock -> String -> Activity -> Maybe Activity
cancelHandoff clock self a =
    if not (isHost self a) || a.state /= Handoff then
        Nothing

    else
        Just (normalize { a | state = Paused, handoffTo = Nothing, position = Just (current clock a), at = Nothing })


{-| Target: accept a pending offer and become host, paused. -}
accept : Clock -> String -> Activity -> Maybe Activity
accept clock self a =
    case normalizeNick self of
        Nothing ->
            Nothing

        Just nick ->
            if a.state /= Handoff || not (sameNick a.handoffTo (Just nick)) then
                Nothing

            else
                Just
                    (normalize
                        { a
                            | host = Just nick
                            , handoffTo = Nothing
                            , state = Paused
                            , position = Just (current clock a)
                            , at = Nothing
                            , participants =
                                if isParticipant nick a then
                                    a.participants

                                else
                                    a.participants ++ [ nick ]
                        }
                    )


{-| Operator: take over an activity whose host is no longer in the
room (the caller checks presence). The timeline keeps running. -}
claim : Clock -> String -> Activity -> Maybe Activity
claim clock self a =
    case normalizeNick self of
        Nothing ->
            Nothing

        Just nick ->
            if isHost nick a then
                Nothing

            else
                Just
                    (normalize
                        (withAnchor clock
                            { a
                                | host = Just nick
                                , state =
                                    if a.state == Handoff then
                                        Paused

                                    else
                                        a.state
                                , handoffTo = Nothing
                                , participants =
                                    if isParticipant nick a then
                                        a.participants

                                    else
                                        nick :: a.participants
                            }
                        )
                    )



-- ── words ──────────────────────────────────────────────────────────────


formatClock : Maybe Int -> String
formatClock seconds =
    case seconds of
        Nothing ->
            "--:--"

        Just s ->
            let
                h =
                    s // 3600

                m =
                    modBy 3600 s // 60

                sec =
                    modBy 60 s

                pad n =
                    String.padLeft 2 '0' (String.fromInt n)
            in
            if h > 0 then
                String.fromInt h ++ ":" ++ pad m ++ ":" ++ pad sec

            else
                String.fromInt m ++ ":" ++ pad sec


stateLabel : Bool -> Activity -> String
stateLabel ended a =
    if ended then
        "Finished"

    else
        case a.state of
            Playing ->
                "Playing"

            Paused ->
                "Paused"

            Seeking ->
                "Seeking"

            Handoff ->
                case a.handoffTo of
                    Just t ->
                        "Handing over to " ++ t

                    Nothing ->
                        "Handoff ready"

            Idle ->
                "Ready"


{-| Editor durations: `1:45:00`, `95:00`, `95` (minutes), or units
like `1h 30m` / `90m` / `45s`. Empty is no duration. -}
parseDuration : String -> Result String (Maybe Int)
parseDuration raw =
    let
        t =
            String.toLower (String.trim raw)

        digits s =
            if not (String.isEmpty s) && String.length s <= 7 && String.all Char.isDigit s then
                String.toInt s

            else
                Nothing

        bound n =
            if n > maxSeconds then
                Err "That is longer than the 366-day limit."

            else
                Ok (Just n)

        unitRe =
            Regex.fromString "^(?:(\\d{1,7})\\s*h(?:ours?|rs?)?)?\\s*(?:(\\d{1,7})\\s*m(?:in(?:utes?|s)?)?)?\\s*(?:(\\d{1,7})\\s*s(?:ec(?:onds?|s)?)?)?$"
                |> Maybe.withDefault Regex.never

        bad =
            Err "Use a length like 1:45:00, 95:00, or 95 (minutes)."
    in
    if String.isEmpty t then
        Ok Nothing

    else if String.contains ":" t then
        case List.map digits (String.split ":" t) of
            [ Just m, Just s ] ->
                if s < 60 then
                    bound (m * 60 + s)

                else
                    bad

            [ Just h, Just m, Just s ] ->
                if m < 60 && s < 60 then
                    bound (h * 3600 + m * 60 + s)

                else
                    bad

            _ ->
                bad

    else
        case digits t of
            Just minutes ->
                bound (minutes * 60)

            Nothing ->
                case Regex.find unitRe t of
                    [ match ] ->
                        let
                            part i =
                                List.drop i match.submatches |> List.head |> Maybe.andThen identity |> Maybe.andThen String.toInt
                        in
                        case ( part 0, part 1, part 2 ) of
                            ( Nothing, Nothing, Nothing ) ->
                                bad

                            ( h, m, s ) ->
                                bound (Maybe.withDefault 0 h * 3600 + Maybe.withDefault 0 m * 60 + Maybe.withDefault 0 s)

                    _ ->
                        bad



-- ── room context ───────────────────────────────────────────────────────


{-| What the rules need from the app, read once per update / view. -}
type alias Ctx =
    { nowMs : Float
    , self : Maybe String
    , activeChannel : Maybe String
    , enabled : Bool
    , online : Bool
    , rawFor : String -> Maybe String
    , canWrite : String -> Bool
    , present : String -> String -> Bool
    , isOperator : String -> String -> Bool
    }


{-| The raw `ocean.watch` value in one room's property map (exact key
first; the server folds key case, a foreign client may not). -}
rawIn : Dict String String -> Maybe String
rawIn props =
    case Dict.get propKey props of
        Just v ->
            nonEmptyRaw v

        Nothing ->
            Dict.foldl
                (\k v acc ->
                    case acc of
                        Just _ ->
                            acc

                        Nothing ->
                            if lower k == propKey then
                                nonEmptyRaw v

                            else
                                Nothing
                )
                Nothing
                props


nonEmptyRaw : String -> Maybe String
nonEmptyRaw v =
    if String.isEmpty v then
        Nothing

    else
        Just v


{-| Build the context from the app model's fields (an extensible
record, so this module never imports `App`). `online` is the live
IRCX link. Writing needs channel operator status or IRC oper — the
server's `propAccess` rule. -}
context :
    Bool
    ->
        { a
            | nowMs : Float
            , ourNick : String
            , activeChannel : Maybe String
            , isOper : Bool
            , prefs : { b | watchTogether : Bool }
            , props : { c | channelProps : Dict String (Dict String String) }
            , channels : Dict String { d | members : Dict String { e | modes : Set Char } }
        }
    -> Ctx
context online model =
    let
        modesOf channel nick =
            Dict.get (lower channel) model.channels
                |> Maybe.andThen (\ch -> Dict.get (lower nick) ch.members)
                |> Maybe.map .modes

        operatorModes modes =
            List.any (\m -> Modes.statusRank m >= Modes.statusRank 'o') (Set.toList modes)
    in
    { nowMs = model.nowMs
    , self = normalizeNick model.ourNick
    , activeChannel = model.activeChannel
    , enabled = model.prefs.watchTogether
    , online = online
    , rawFor =
        \channel ->
            Dict.get (lower channel) model.props.channelProps |> Maybe.andThen rawIn
    , canWrite =
        \channel ->
            model.isOper
                || (modesOf channel model.ourNick |> Maybe.map operatorModes |> Maybe.withDefault False)
    , present = \channel nick -> modesOf channel nick /= Nothing
    , isOperator =
        \channel nick ->
            modesOf channel nick |> Maybe.map operatorModes |> Maybe.withDefault False
    }


{-| The host is still in the room. -}
hostPresent : Ctx -> String -> Activity -> Bool
hostPresent ctx channel a =
    case a.host of
        Just h ->
            ctx.present channel h

        Nothing ->
            False


canStart : Ctx -> String -> Result String ()
canStart ctx channel =
    if not ctx.online then
        Err "Watch together needs a live connection."

    else if ctx.self == Nothing then
        Err "Sign in before starting a watch activity."

    else if ctx.rawFor channel /= Nothing then
        Err (channel ++ " already has a watch activity.")

    else if not (ctx.canWrite channel) then
        Err ("Only room operators can start a watch activity in " ++ channel ++ ".")

    else
        Ok ()


{-| The host may end; so may any operator once the host has left. -}
canEnd : Ctx -> String -> Activity -> Bool
canEnd ctx channel a =
    case ctx.self of
        Just self ->
            ctx.online && ctx.canWrite channel && (isHost self a || not (hostPresent ctx channel a))

        Nothing ->
            False



-- ── UI state ───────────────────────────────────────────────────────────


type Field
    = TitleField
    | UrlField
    | DurationField
    | FormField


type EditStep
    = Editing
    | Reviewing Activity


type alias Editor =
    { channel : String
    , title : String
    , url : String
    , duration : String
    , step : EditStep
    , error : Maybe ( Field, String )
    }


type Tone
    = Info
    | Problem


type alias Notice =
    { channel : String, text : String, tone : Tone }


type Action
    = ActStart
    | ActPlay
    | ActPause
    | ActSeek
    | ActOffer
    | ActCancel
    | ActAccept
    | ActJoin
    | ActLeave
    | ActClaim
    | ActEnd


type alias Pending =
    { channel : String, action : Action, sentAt : Float }


{-| The exact value a control was rendered against: a click that
lands after the activity, the room or the identity changed fails
closed (the oracle's stale-revision guard). -}
type alias Rev =
    { channel : String, raw : String, self : String }


type alias Model =
    { editor : Maybe Editor
    , expanded : Bool
    , rosterOpen : Bool
    , endConfirm : Maybe Rev
    , handoffChoice : String
    , scrub : Maybe ( String, Int )
    , notice : Maybe Notice
    , pending : Maybe Pending
    , queuedSeek : Maybe ( String, Int )
    , anchors : Dict String Anchor
    }


blank : Model
blank =
    { editor = Nothing
    , expanded = False
    , rosterOpen = False
    , endConfirm = Nothing
    , handoffChoice = ""
    , scrub = Nothing
    , notice = Nothing
    , pending = Nothing
    , queuedSeek = Nothing
    , anchors = Dict.empty
    }


type Msg
    = MenuSelect String
    | EditorClose
    | EditTitle String
    | EditUrl String
    | EditDuration String
    | EditorReview
    | EditorBack
    | EditorConfirm
    | ToggleExpanded
    | ToggleRoster
    | Hide
    | Play Rev
    | Pause Rev
    | Scrub String
    | SeekTo Rev String
    | Nudge Rev Int
    | ChooseHandoff String
    | Offer Rev
    | CancelOffer Rev
    | Accept Rev
    | Claim Rev
    | Join Rev
    | Leave Rev
    | AskEnd Rev
    | CancelEnd
    | ConfirmEnd Rev
    | DismissNotice


type Effect
    = Publish String String
    | Remove String
    | LocalDelete String
    | Focus String
    | SetEnabled Bool
    | Toast Tone String String


pendingFor : String -> Model -> Maybe Pending
pendingFor channel model =
    case model.pending of
        Just p ->
            if lower p.channel == lower channel then
                Just p

            else
                Nothing

        Nothing ->
            Nothing


notice : String -> Tone -> String -> Model -> Model
notice channel tone text model =
    { model | notice = Just { channel = channel, text = text, tone = tone } }


blankEditor : String -> Editor
blankEditor channel =
    { channel = channel, title = "", url = "", duration = "", step = Editing, error = Nothing }


setEditor : (Editor -> Editor) -> Model -> Model
setEditor f model =
    { model | editor = Maybe.map f model.editor }


update : Ctx -> Msg -> Model -> ( Model, List Effect )
update ctx msg model =
    case msg of
        MenuSelect channel ->
            let
                enable =
                    if ctx.enabled then
                        []

                    else
                        [ SetEnabled True ]
            in
            case ctx.rawFor channel |> Maybe.andThen parse of
                Just _ ->
                    ( { model | expanded = True }, enable ++ [ Focus "watch-details-toggle" ] )

                Nothing ->
                    case canStart ctx channel of
                        Ok () ->
                            ( { model | editor = Just (blankEditor channel) }, enable )

                        Err reason ->
                            ( model, [ Toast Problem "Can't start watch together" reason ] )

        EditorClose ->
            ( { model | editor = Nothing }, [] )

        EditTitle v ->
            ( setEditor (\e -> { e | title = v, error = clearFieldError TitleField e.error }) model, [] )

        EditUrl v ->
            ( setEditor (\e -> { e | url = v, error = clearFieldError UrlField e.error }) model, [] )

        EditDuration v ->
            ( setEditor (\e -> { e | duration = v, error = clearFieldError DurationField e.error }) model, [] )

        EditorReview ->
            case model.editor of
                Just editor ->
                    case validate ctx editor of
                        Ok activity ->
                            ( { model | editor = Just { editor | step = Reviewing activity, error = Nothing } }
                            , [ Focus "watch-start-confirm" ]
                            )

                        Err ( field, text ) ->
                            ( { model | editor = Just { editor | error = Just ( field, text ) } }
                            , [ Focus (fieldId field) ]
                            )

                Nothing ->
                    ( model, [] )

        EditorBack ->
            ( setEditor (\e -> { e | step = Editing }) model, [ Focus "watch-start-title" ] )

        EditorConfirm ->
            case model.editor of
                Just editor ->
                    case editor.step of
                        Reviewing staged ->
                            confirmStart ctx editor staged model

                        Editing ->
                            ( model, [] )

                Nothing ->
                    ( model, [] )

        ToggleExpanded ->
            ( { model | expanded = not model.expanded, rosterOpen = model.rosterOpen && not model.expanded }, [] )

        ToggleRoster ->
            ( { model | rosterOpen = not model.rosterOpen }, [] )

        Hide ->
            ( { model | expanded = False, rosterOpen = False, endConfirm = Nothing, notice = Nothing }
            , [ SetEnabled False
              , Toast Info "Watch together hidden" "Turn it back on from a room's More menu or in Preferences."
              ]
            )

        Play rev ->
            mutate ctx rev ActPlay "start playback" play model

        Pause rev ->
            mutate ctx rev ActPause "pause" pause model

        Scrub v ->
            case ( ctx.activeChannel, String.toInt v ) of
                ( Just ch, Just n ) ->
                    ( { model | scrub = Just ( lower ch, n ) }, [] )

                _ ->
                    ( model, [] )

        SeekTo rev v ->
            case String.toInt v of
                Just target ->
                    seekTo ctx rev target { model | scrub = Nothing }

                Nothing ->
                    ( { model | scrub = Nothing }, [] )

        Nudge rev delta ->
            case ctx.rawFor rev.channel |> Maybe.andThen parse of
                Just a ->
                    let
                        clock =
                            clockFor ctx.nowMs model.anchors rev.channel rev.raw a
                    in
                    seekTo ctx rev (current clock a + delta) model

                Nothing ->
                    mutate ctx rev ActSeek "move the position" (\_ _ _ -> Nothing) model

        ChooseHandoff nick ->
            ( { model | handoffChoice = nick }, [] )

        Offer rev ->
            let
                target =
                    case ctx.rawFor rev.channel |> Maybe.andThen parse of
                        Just a ->
                            chosenTarget ctx rev.channel model.handoffChoice a

                        Nothing ->
                            Nothing
            in
            case target of
                Just t ->
                    mutate ctx rev ActOffer "offer hosting" (\clock self a -> offer clock self t a) model

                Nothing ->
                    ( notice rev.channel Problem "Choose someone who can take over hosting first." model, [ Focus "watch-status" ] )

        CancelOffer rev ->
            mutate ctx rev ActCancel "cancel the handoff" cancelHandoff model

        Accept rev ->
            mutate ctx rev ActAccept "accept hosting" accept model

        Claim rev ->
            mutate ctx
                rev
                ActClaim
                "take over hosting"
                (\clock self a ->
                    if hostPresent ctx rev.channel a then
                        Nothing

                    else
                        claim clock self a
                )
                model

        Join rev ->
            mutate ctx rev ActJoin "join" join model

        Leave rev ->
            mutate ctx rev ActLeave "leave" leave model

        AskEnd rev ->
            case guard ctx rev model of
                Ok ( a, _ ) ->
                    if canEnd ctx rev.channel a then
                        ( { model | endConfirm = Just rev, notice = Nothing }, [ Focus "watch-end-confirm" ] )

                    else
                        ( notice rev.channel Problem "Only the host can end this activity." model, [ Focus "watch-status" ] )

                Err text ->
                    ( notice rev.channel Problem text model, [ Focus "watch-status" ] )

        CancelEnd ->
            ( { model | endConfirm = Nothing }, [ Focus "watch-end" ] )

        ConfirmEnd rev ->
            case model.endConfirm of
                Just staged ->
                    if staged /= rev then
                        ( { model | endConfirm = Nothing }, [] )

                    else
                        case guard ctx rev model of
                            Ok ( a, _ ) ->
                                if canEnd ctx rev.channel a then
                                    ( { model
                                        | endConfirm = Nothing
                                        , pending = Just { channel = rev.channel, action = ActEnd, sentAt = ctx.nowMs }
                                        , notice = Just { channel = rev.channel, text = "Ending the activity…", tone = Info }
                                      }
                                    , [ Remove rev.channel, Focus "watch-status" ]
                                    )

                                else
                                    ( notice rev.channel Problem "Not ended: you are no longer allowed to end this activity." { model | endConfirm = Nothing }
                                    , [ Focus "watch-status" ]
                                    )

                            Err text ->
                                ( notice rev.channel Problem ("Not ended. " ++ text) { model | endConfirm = Nothing }
                                , [ Focus "watch-status" ]
                                )

                Nothing ->
                    ( model, [] )

        DismissNotice ->
            ( { model | notice = Nothing }, [] )


clearFieldError : Field -> Maybe ( Field, String ) -> Maybe ( Field, String )
clearFieldError field error =
    case error of
        Just ( f, _ ) ->
            if f == field || f == FormField then
                Nothing

            else
                error

        Nothing ->
            Nothing


fieldId : Field -> String
fieldId field =
    case field of
        TitleField ->
            "watch-start-title"

        UrlField ->
            "watch-start-url"

        DurationField ->
            "watch-start-duration"

        FormField ->
            "watch-start-title"


chosenTarget : Ctx -> String -> String -> Activity -> Maybe String
chosenTarget ctx channel choice a =
    let
        targets =
            handoffTargets (ctx.isOperator channel) a
    in
    case List.filter (\t -> lower t == lower choice) targets of
        t :: _ ->
            Just t

        [] ->
            List.head targets


{-| Start-editor validation → the activity to review. -}
validate : Ctx -> Editor -> Result ( Field, String ) Activity
validate ctx editor =
    let
        title =
            String.trim editor.title

        url =
            String.trim editor.url

        link =
            if String.isEmpty url then
                Ok Nothing

            else
                Result.map Just (checkUrl url)
    in
    if String.isEmpty title then
        Err ( TitleField, "Give the activity a title." )

    else if String.length title > maxTitleLength then
        Err ( TitleField, "Keep the title to " ++ String.fromInt maxTitleLength ++ " characters or fewer." )

    else
        case link of
            Err problem ->
                Err ( UrlField, urlProblemText problem )

            Ok checkedLink ->
                case parseDuration editor.duration of
                    Err text ->
                        Err ( DurationField, text )

                    Ok duration ->
                        case ( ctx.self, canStart ctx editor.channel ) of
                            ( _, Err reason ) ->
                                Err ( FormField, reason )

                            ( Nothing, _ ) ->
                                Err ( FormField, "Sign in before starting a watch activity." )

                            ( Just self, Ok () ) ->
                                let
                                    activity =
                                        start { host = self, title = title, url = checkedLink, duration = duration }

                                    over =
                                        String.length (encode activity) + startReserve - wireBudget
                                in
                                if over > 0 || activity.url /= checkedLink then
                                    Err
                                        ( if checkedLink /= Nothing then
                                            UrlField

                                          else
                                            TitleField
                                        , "Too long to share in a room. Shorten the title or link by about "
                                            ++ String.fromInt (max 1 over)
                                            ++ " characters."
                                        )

                                else
                                    Ok activity


urlProblemText : UrlProblem -> String
urlProblemText problem =
    case problem of
        UrlEmpty ->
            "Add a link, or leave it empty."

        UrlTooLong ->
            "Links can be up to " ++ String.fromInt maxUrlLength ++ " characters."

        UrlScheme ->
            "Use a web link that starts with https:// or http://."

        UrlCharacters ->
            "Remove spaces, backslashes and control characters from the link."

        UrlCredentials ->
            "Links with a user name or password are not allowed."

        UrlNonAsciiHost ->
            "Use the plain (xn--) form of international domain names."

        UrlBadHost ->
            "That does not look like a valid web address."


confirmStart : Ctx -> Editor -> Activity -> Model -> ( Model, List Effect )
confirmStart ctx editor staged model =
    let
        sameRoom =
            Maybe.map lower ctx.activeChannel == Just (lower editor.channel)

        back text =
            ( { model | editor = Just { editor | step = Editing, error = Just ( FormField, text ) } }
            , [ Focus "watch-start-title" ]
            )
    in
    if not sameRoom then
        ( { model | editor = Nothing }
        , [ Toast Problem "Watch activity not started" "The active room changed before you confirmed." ]
        )

    else if ctx.rawFor editor.channel /= Nothing then
        ( { model | editor = Nothing }
        , [ Toast Problem "Watch activity not started" ("A watch activity started in " ++ editor.channel ++ " while you were reviewing, so nothing was replaced.") ]
        )

    else if not (sameNick ctx.self staged.host) then
        back "Not started: your signed-in name changed. Review it again."

    else
        case canStart ctx editor.channel of
            Err reason ->
                back reason

            Ok () ->
                ( { model
                    | editor = Nothing
                    , pending = Just { channel = editor.channel, action = ActStart, sentAt = ctx.nowMs }
                    , notice = Nothing
                  }
                , Publish editor.channel (serialize staged)
                    :: (if ctx.enabled then
                            []

                        else
                            [ SetEnabled True ]
                       )
                )


{-| The stale-revision guard: same room, same value, same identity,
still live and allowed to write. -}
guard : Ctx -> Rev -> Model -> Result String ( Activity, Clock )
guard ctx rev model =
    if Maybe.map lower ctx.activeChannel /= Just (lower rev.channel) then
        Err "The active room changed."

    else if Maybe.map lower ctx.self /= Just (lower rev.self) then
        Err "Your signed-in name changed."

    else if ctx.rawFor rev.channel /= Just rev.raw then
        Err "The activity changed. Review it and try again."

    else if not ctx.online then
        Err "Watch together needs a live connection."

    else if not (ctx.canWrite rev.channel) then
        Err ("Only room operators can change the watch activity in " ++ rev.channel ++ ".")

    else
        case parse rev.raw of
            Just a ->
                Ok ( a, clockFor ctx.nowMs model.anchors rev.channel rev.raw a )

            Nothing ->
                Err "The activity is no longer available."


busy : Ctx -> String -> Model -> Bool
busy ctx channel model =
    case pendingFor channel model of
        Just p ->
            ctx.nowMs - p.sentAt < pendingTimeoutMs

        Nothing ->
            False


mutate : Ctx -> Rev -> Action -> String -> (Clock -> String -> Activity -> Maybe Activity) -> Model -> ( Model, List Effect )
mutate ctx rev action verb transition model =
    if busy ctx rev.channel model then
        ( model, [] )

    else
        case guard ctx rev model of
            Err text ->
                ( notice rev.channel Problem ("Could not " ++ verb ++ ". " ++ text) model, [ Focus "watch-status" ] )

            Ok ( a, clock ) ->
                case transition clock rev.self a of
                    Just next ->
                        ( { model
                            | pending = Just { channel = rev.channel, action = action, sentAt = ctx.nowMs }
                            , notice = Nothing
                          }
                        , [ Publish rev.channel (serialize next) ]
                        )

                    Nothing ->
                        ( notice rev.channel
                            Problem
                            (case action of
                                ActJoin ->
                                    "Could not join: the activity is full."

                                _ ->
                                    "Could not " ++ verb ++ ": the activity no longer needs that change."
                            )
                            model
                        , [ Focus "watch-status" ]
                        )


{-| Seeks coalesce: while a change is in flight the latest target waits
and goes out when the server answers. -}
seekTo : Ctx -> Rev -> Int -> Model -> ( Model, List Effect )
seekTo ctx rev target model =
    if busy ctx rev.channel model then
        ( { model | queuedSeek = Just ( lower rev.channel, target ) }, [] )

    else
        mutate ctx rev ActSeek "move the position" (\clock self a -> seek clock self target a) model



-- ── settling (run after every app update) ──────────────────────────────


successText : Action -> String
successText action =
    case action of
        ActStart ->
            "Watch activity started. You are hosting."

        ActPlay ->
            "Playing for everyone."

        ActPause ->
            "Paused for everyone."

        ActSeek ->
            "Position moved for everyone."

        ActOffer ->
            "Hosting offered. Waiting for them to accept."

        ActCancel ->
            "Handoff cancelled. You are still hosting."

        ActAccept ->
            "You are hosting now."

        ActJoin ->
            "You joined."

        ActLeave ->
            "You left the activity."

        ActClaim ->
            "You are hosting now."

        ActEnd ->
            "Watch activity ended."


{-| Fold one inbound line into the in-flight change: `818` for the
room's `ocean.watch` confirms a set, `819` confirms a delete (applied
locally — the server sends the setter no other echo), `913` / `461` /
`905` / `906` / `908` refuse it.
-}
settleLine : Ctx -> Wire.IrcMessage -> ( Model, List Effect ) -> ( Model, List Effect )
settleLine ctx message ( model, effects ) =
    case model.pending of
        Nothing ->
            ( model, effects )

        Just p ->
            let
                param i =
                    List.drop i message.params |> List.head |> Maybe.withDefault ""

                forRoom i =
                    lower (param i) == lower p.channel

                done text tone extra =
                    let
                        cleared =
                            { model | pending = Nothing }
                    in
                    if p.action == ActStart || p.action == ActEnd then
                        -- start / end outcomes may have no card to speak in
                        ( { cleared | notice = Nothing }
                        , effects ++ extra ++ [ Toast tone (toastTitle p.action tone) text ]
                        )

                    else
                        ( notice p.channel tone text cleared, effects ++ extra )

                refused text =
                    done text Problem []
            in
            case message.command of
                "818" ->
                    if forRoom 1 && lower (param 2) == propKey && p.action /= ActEnd then
                        let
                            ( next, out ) =
                                done (successText p.action) Info []
                        in
                        flushSeek ctx ( next, out )

                    else
                        ( model, effects )

                "819" ->
                    if forRoom 1 && p.action == ActEnd then
                        let
                            ( next, out ) =
                                done (successText ActEnd) Info [ LocalDelete p.channel, Focus "shell-composer-input" ]
                        in
                        ( { next | expanded = False, rosterOpen = False }, out )

                    else
                        ( model, effects )

                "913" ->
                    if forRoom 1 then
                        refused "Onyx Server refused it: only room operators can change a watch activity."

                    else
                        ( model, effects )

                "461" ->
                    if lower (param 1) == "prop" then
                        refused "Onyx Server rejected the update (too long or malformed)."

                    else
                        ( model, effects )

                _ ->
                    if List.member message.command [ "905", "906", "908" ] && forRoom 1 then
                        refused "Onyx Server refused the update."

                    else
                        ( model, effects )


toastTitle : Action -> Tone -> String
toastTitle action tone =
    case ( action, tone ) of
        ( ActStart, Problem ) ->
            "Watch activity not started"

        ( ActEnd, Problem ) ->
            "Watch activity not ended"

        _ ->
            "Watch together"


flushSeek : Ctx -> ( Model, List Effect ) -> ( Model, List Effect )
flushSeek ctx ( model, effects ) =
    case model.queuedSeek of
        Just ( channel, target ) ->
            let
                cleared =
                    { model | queuedSeek = Nothing }
            in
            case ( ctx.self, ctx.rawFor channel ) of
                ( Just self, Just raw ) ->
                    let
                        ( next, out ) =
                            seekTo ctx { channel = channel, raw = raw, self = self } target cleared
                    in
                    ( next, effects ++ out )

                _ ->
                    ( cleared, effects )

        Nothing ->
            ( model, effects )


{-| A change nobody answered within ten seconds stops blocking the
controls and says so. -}
settleTick : Ctx -> Model -> Model
settleTick ctx model =
    case model.pending of
        Just p ->
            if ctx.nowMs - p.sentAt >= pendingTimeoutMs then
                notice p.channel Problem "No answer from the server yet. The activity may not have changed." { model | pending = Nothing, queuedSeek = Nothing }

            else
                model

        Nothing ->
            model


{-| Room-scoped UI resets: a new active room drops drafts, the roster,
an end confirmation and notices; a changed value retires a staged end
confirmation and a start review that is no longer true. -}
settleRoom : { channel : Maybe String, raw : Maybe String } -> Ctx -> Model -> ( Model, List Effect )
settleRoom prior ctx model =
    let
        roomChanged =
            Maybe.map lower prior.channel /= Maybe.map lower ctx.activeChannel

        nowRaw =
            ctx.activeChannel |> Maybe.andThen ctx.rawFor
    in
    if roomChanged then
        ( { model
            | editor = Nothing
            , expanded = False
            , rosterOpen = False
            , endConfirm = Nothing
            , handoffChoice = ""
            , scrub = Nothing
            , notice = Nothing
            , queuedSeek = Nothing
          }
        , []
        )

    else if nowRaw /= prior.raw then
        let
            ( afterEnd, endFx ) =
                case model.endConfirm of
                    Just _ ->
                        ( notice (Maybe.withDefault "" ctx.activeChannel)
                            Problem
                            "The activity changed before you confirmed, so it was not ended. Review it and try again."
                            { model | endConfirm = Nothing }
                        , [ Focus "watch-status" ]
                        )

                    Nothing ->
                        ( model, [] )

            ( afterReview, reviewFx ) =
                case ( afterEnd.editor, nowRaw ) of
                    ( Just editor, Just _ ) ->
                        case editor.step of
                            Reviewing _ ->
                                ( { afterEnd | editor = Nothing }
                                , [ Toast Problem "Watch activity not started" ("A watch activity started in " ++ editor.channel ++ " while you were reviewing, so nothing was replaced.") ]
                                )

                            Editing ->
                                ( afterEnd, [] )

                    _ ->
                        ( afterEnd, [] )
        in
        ( if nowRaw == Nothing then
            { afterReview | scrub = Nothing, rosterOpen = False }

          else
            afterReview
        , endFx ++ reviewFx
        )

    else
        ( model, [] )


{-| Record an anchor for every room value first seen, keep anchors
for unchanged values, and forget rooms whose activity is gone. -}
reconcile : Float -> List ( String, String ) -> Model -> Model
reconcile nowMs raws model =
    let
        anchors =
            List.foldl
                (\( channel, raw ) acc ->
                    let
                        key =
                            lower channel
                    in
                    case parse raw of
                        Just a ->
                            Dict.insert key (anchorFor nowMs (Dict.get key model.anchors) raw a) acc

                        Nothing ->
                            acc
                )
                Dict.empty
                raws
    in
    if anchors == model.anchors then
        model

    else
        { model | anchors = anchors }

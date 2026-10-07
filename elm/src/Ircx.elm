module Ircx exposing
    ( AccessEntry
    , AccessFold(..)
    , AccessLevel(..)
    , AccessState
    , Ircx800
    , PropState
    , WhisperFold(..)
    , accessAdd
    , accessClear
    , accessDelete
    , accessEntryKey
    , accessLevelHint
    , accessLevelLabel
    , accessList
    , blankAccessState
    , blankPropState
    , boundedPropertyValue
    , foldAccessLine
    , foldLivePropLine
    , foldPropLine
    , foldWhisperLine
    , formatAccessDuration
    , ircxDisable
    , ircxEnable
    , isChanTarget
    , isircxQuery
    , listx
    , maxAccessListChannels
    , maxAccessListEntries
    , maxLivePropKeyLength
    , maxLivePropKeys
    , isUnsafeKey
    , maxLivePropTargets
    , maxLivePropValueLength
    , normalizeAccessEntry
    , normalizeAccessMask
    , normalizePropertyName
    , normalizePropertyTarget
    , paramAt
    , parseAccessDuration
    , parseAccessLevel
    , parseIrcx800
    , propGet
    , propList
    , propSet
    , removeAccessEntry
    , sendData
    , sendReply
    , sendRequest
    , sortAccessEntries
    , updateBoundedProperties
    , upsertAccessEntry
    , validateDataTag
    , whisper
    )

{-| IRCX extensions — Elm port of `lib/irc/channelAccess.ts` (ACCESS
levels/masks/entries) and the `store.ts` IRCX folds (ACCESS 801–805 +
775/776, PROP 818/819, WHISPER), plus fail-closed builders for
`IRCX`/`ISIRCX`, `DATA`/`REQUEST`/`REPLY`, `WHISPER`, `PROP`,
`ACCESS`, and `LISTX` (protocol §10).

953 nuance preserved: `WHISPER <#chan> <nick[,nick]> :<text>` is
channel-scoped; `+w` blocks arrive as `923` (surfaced by the generic
numeric path, like the oracle). `LISTX` rows have no client fold — the
TS client never consumed 811/812/816/817 — so only the builder ships.

-}

import Dict exposing (Dict)
import Set exposing (Set)
import Wire


maxAccessListEntries : Int
maxAccessListEntries =
    256


maxAccessListChannels : Int
maxAccessListChannels =
    32


maxAccessMaskLength : Int
maxAccessMaskLength =
    128


maxAccessSetterLength : Int
maxAccessSetterLength =
    64


maxAccessTimeoutSeconds : Int
maxAccessTimeoutSeconds =
    2592000


maxLivePropTargets : Int
maxLivePropTargets =
    256


maxLivePropKeys : Int
maxLivePropKeys =
    64


maxLivePropKeyLength : Int
maxLivePropKeyLength =
    128


maxLivePropValueLength : Int
maxLivePropValueLength =
    16384



-- ── ACCESS levels & entries ──────────────────────────────────────────


type AccessLevel
    = Founder
    | Owner
    | Host
    | Voice
    | Grant
    | Deny


parseAccessLevel : Maybe String -> Maybe AccessLevel
parseAccessLevel raw =
    case Maybe.map (String.toUpper << String.trim) raw of
        Just "FOUNDER" ->
            Just Founder

        Just "OWNER" ->
            Just Owner

        Just "HOST" ->
            Just Host

        Just "VOICE" ->
            Just Voice

        Just "GRANT" ->
            Just Grant

        Just "DENY" ->
            Just Deny

        _ ->
            Nothing


accessLevelLabel : AccessLevel -> String
accessLevelLabel level =
    case level of
        Founder ->
            "Founder"

        Owner ->
            "Owner"

        Host ->
            "Operator (host)"

        Voice ->
            "Voice"

        Grant ->
            "Grant (bypass deny)"

        Deny ->
            "Deny"


accessLevelHint : AccessLevel -> String
accessLevelHint level =
    case level of
        Founder ->
            "Highest persistent rank on join."

        Owner ->
            "Owner (+q) on join."

        Host ->
            "Channel operator (+o) on join."

        Voice ->
            "Voice (+v) on join."

        Grant ->
            "Bypass a matching network-level deny."

        Deny ->
            "Block matching hosts from joining."


{-| Accept a full hostmask or a bare nick (expanded to `nick!*@*`).
Control chars and spaces are never valid; structured masks need
non-empty nick/user/host parts.
-}
normalizeAccessMask : Maybe String -> Maybe String
normalizeAccessMask raw =
    case Maybe.map String.trim raw of
        Nothing ->
            Nothing

        Just "" ->
            Nothing

        Just trimmed ->
            let
                candidate =
                    if String.contains "!" trimmed then
                        trimmed

                    else
                        trimmed ++ "!*@*"
            in
            if String.length candidate > maxAccessMaskLength then
                Nothing

            else if String.any isUnsafeMaskChar candidate then
                Nothing

            else if String.contains "!" candidate || String.contains "@" candidate then
                case ( String.indexes "!" candidate, String.indexes "@" candidate ) of
                    ( bang :: _, at :: _ ) ->
                        if bang <= 0 || at <= bang + 1 || at == String.length candidate - 1 then
                            Nothing

                        else
                            Just candidate

                    _ ->
                        Nothing

            else
                Just candidate


isUnsafeMaskChar : Char -> Bool
isUnsafeMaskChar c =
    c <= ' ' || Char.toCode c == 127


{-| Prefix-tolerant seconds (`parseInt` semantics); 0/empty is
permanent (`Nothing`), out-of-range is invalid (`Nothing`).
Leading ASCII whitespace is skipped and one `+` sign honored before
the leading digits are taken (mirroring `parseInt`, and the shared
`parseLeadingInt` precedent); a `-` sign can never satisfy the
non-negative gate.
-}
parseAccessDuration : Maybe String -> Maybe Int
parseAccessDuration raw =
    case raw of
        Nothing ->
            Nothing

        Just "" ->
            Nothing

        Just text ->
            let
                trimmed =
                    dropLeadingSpace text

                digits =
                    case String.uncons trimmed of
                        Just ( '+', rest ) ->
                            prefixDigits rest

                        Just ( '-', _ ) ->
                            ""

                        _ ->
                            prefixDigits trimmed
            in
            case String.toInt digits of
                Nothing ->
                    Nothing

                Just 0 ->
                    Nothing

                Just n ->
                    if n < 0 || n > maxAccessTimeoutSeconds then
                        Nothing

                    else
                        Just n


dropLeadingSpace : String -> String
dropLeadingSpace value =
    case String.uncons value of
        Just ( c, rest ) ->
            if c <= ' ' then
                dropLeadingSpace rest

            else
                value

        Nothing ->
            value


prefixDigits : String -> String
prefixDigits text =
    text
        |> String.toList
        |> takeDigits
        |> String.fromList


takeDigits : List Char -> List Char
takeDigits chars =
    case chars of
        c :: rest ->
            if Char.isDigit c then
                c :: takeDigits rest

            else
                []

        [] ->
            []


type alias AccessEntry =
    { level : AccessLevel
    , mask : String
    , setBy : Maybe String
    , duration : Maybe Int
    }


normalizeAccessEntry :
    { level : Maybe String
    , mask : Maybe String
    , setBy : Maybe String
    , duration : Maybe String
    }
    -> Maybe AccessEntry
normalizeAccessEntry input =
    case ( parseAccessLevel input.level, normalizeAccessMask input.mask ) of
        ( Just level, Just mask ) ->
            let
                setByRaw =
                    String.slice 0 maxAccessSetterLength (String.trim (Maybe.withDefault "" input.setBy))

                setBy =
                    if String.isEmpty setByRaw || String.any isUnsafeMaskChar setByRaw then
                        Nothing

                    else
                        Just setByRaw
            in
            Just
                { level = level
                , mask = mask
                , setBy = setBy
                , duration = parseAccessDuration input.duration
                }

        _ ->
            Nothing


accessEntryKey : AccessEntry -> String
accessEntryKey entry =
    accessLevelName entry.level
        ++ String.fromChar (Char.fromCode 0)
        ++ String.toLower entry.mask


accessLevelName : AccessLevel -> String
accessLevelName level =
    case level of
        Founder ->
            "FOUNDER"

        Owner ->
            "OWNER"

        Host ->
            "HOST"

        Voice ->
            "VOICE"

        Grant ->
            "GRANT"

        Deny ->
            "DENY"


{-| Immutable append/replace by (level, mask); over-cap drops oldest.
-}
upsertAccessEntry : List AccessEntry -> AccessEntry -> List AccessEntry
upsertAccessEntry list entry =
    let
        key =
            accessEntryKey entry

        next =
            List.filter (\row -> accessEntryKey row /= key) list ++ [ entry ]
    in
    List.drop (max 0 (List.length next - maxAccessListEntries)) next


removeAccessEntry : List AccessEntry -> AccessLevel -> String -> List AccessEntry
removeAccessEntry list level mask =
    case normalizeAccessMask (Just mask) of
        Nothing ->
            list

        Just normalized ->
            let
                key =
                    accessLevelName level
                        ++ String.fromChar (Char.fromCode 0)
                        ++ String.toLower normalized
            in
            List.filter (\row -> accessEntryKey row /= key) list


{-| Stable sort: DENY first (security-visible), then rank, then mask
(case-insensitive, approximating the oracle's base-sensitivity
`localeCompare`).
-}
sortAccessEntries : List AccessEntry -> List AccessEntry
sortAccessEntries entries =
    List.sortWith
        (\a b ->
            case compare (accessRank a.level) (accessRank b.level) of
                EQ ->
                    compare (String.toLower a.mask) (String.toLower b.mask)

                other ->
                    other
        )
        entries


accessRank : AccessLevel -> Int
accessRank level =
    case level of
        Deny ->
            0

        Founder ->
            1

        Owner ->
            2

        Host ->
            3

        Grant ->
            4

        Voice ->
            5


formatAccessDuration : Maybe Int -> String
formatAccessDuration duration =
    case duration of
        Nothing ->
            "Permanent"

        Just seconds ->
            if seconds <= 0 then
                "Permanent"

            else if modBy 86400 seconds == 0 then
                let
                    days =
                        seconds // 86400
                in
                if days == 1 then
                    "1 day"

                else
                    String.fromInt days ++ " days"

            else if modBy 3600 seconds == 0 then
                let
                    hours =
                        seconds // 3600
                in
                if hours == 1 then
                    "1 hour"

                else
                    String.fromInt hours ++ " hours"

            else if modBy 60 seconds == 0 then
                let
                    minutes =
                        seconds // 60
                in
                if minutes == 1 then
                    "1 minute"

                else
                    String.fromInt minutes ++ " minutes"

            else
                String.fromInt seconds ++ "s"



-- ── ACCESS fold state ────────────────────────────────────────────────


type alias AccessState =
    { lists : Dict String (List AccessEntry)
    , buffers : Dict String (List AccessEntry)
    , loading : Set String
    }


type AccessFold
    = AccessNoChange
    | AccessUpdated AccessState
    | AccessServiceNote { kind : String, text : String }


blankAccessState : AccessState
blankAccessState =
    { lists = Dict.empty, buffers = Dict.empty, loading = Set.empty }


{-| Fold 801–805 (+ legacy 775/776 service notices). `knownChannels`
holds lowercase channel keys the client has joined: like the oracle,
rows for unknown channels never allocate state. Returns a service
notice string for the legacy 775/776 path.
-}
foldAccessLine : Set String -> AccessState -> Wire.IrcMessage -> AccessFold
foldAccessLine knownChannels state message =
    case message.command of
        "801" ->
            case accessRowTarget knownChannels message of
                Nothing ->
                    AccessNoChange

                Just key ->
                    case normalizeAccessEntry { level = paramAt 2 message.params, mask = paramAt 3 message.params, setBy = Nothing, duration = Nothing } of
                        Nothing ->
                            AccessNoChange

                        Just entry ->
                            if not (Dict.member key state.lists) && Dict.size state.lists >= maxAccessListChannels then
                                AccessNoChange

                            else
                                AccessUpdated
                                    { state
                                        | lists =
                                            Dict.insert key
                                                (upsertAccessEntry (Maybe.withDefault [] (Dict.get key state.lists)) entry)
                                                state.lists
                                    }

        "802" ->
            case accessRowTarget knownChannels message of
                Nothing ->
                    AccessNoChange

                Just key ->
                    case ( parseAccessLevel (paramAt 2 message.params), normalizeAccessMask (paramAt 3 message.params) ) of
                        ( Just level, Just _ ) ->
                            case Dict.get key state.lists of
                                Nothing ->
                                    AccessNoChange

                                Just existing ->
                                    AccessUpdated
                                        { state
                                            | lists =
                                                Dict.insert key
                                                    (removeAccessEntry existing level (Maybe.withDefault "" (paramAt 3 message.params)))
                                                    state.lists
                                        }

                        _ ->
                            AccessNoChange

        "803" ->
            case accessListTarget knownChannels message of
                Nothing ->
                    AccessNoChange

                Just key ->
                    if not (Dict.member key state.buffers) && Dict.size state.buffers >= maxAccessListChannels then
                        AccessNoChange

                    else
                        AccessUpdated
                            { state
                                | buffers = Dict.insert key [] state.buffers
                                , loading = Set.insert key state.loading
                            }

        "804" ->
            case accessListTarget knownChannels message of
                Nothing ->
                    AccessNoChange

                Just key ->
                    let
                        buffered =
                            Maybe.withDefault [] (Dict.get key state.buffers)
                    in
                    if List.length buffered >= maxAccessListEntries && Dict.member key state.buffers then
                        AccessNoChange

                    else
                        case
                            normalizeAccessEntry
                                { level = paramAt 2 message.params
                                , mask = paramAt 3 message.params
                                , setBy = paramAt 4 message.params
                                , duration = paramAt 5 message.params
                                }
                        of
                            Nothing ->
                                -- Malformed rows never allocate a buffer for an
                                -- unknown channel; a known channel keeps its
                                -- (possibly fresh) buffer slot.
                                if Dict.member key state.buffers then
                                    AccessNoChange

                                else if Dict.size state.buffers >= maxAccessListChannels then
                                    AccessNoChange

                                else
                                    AccessUpdated { state | buffers = Dict.insert key [] state.buffers }

                            Just entry ->
                                let
                                    base =
                                        if Dict.member key state.buffers then
                                            buffered

                                        else
                                            []
                                in
                                if Dict.size state.buffers >= maxAccessListChannels && not (Dict.member key state.buffers) then
                                    AccessNoChange

                                else
                                    AccessUpdated
                                        { state | buffers = Dict.insert key (upsertAccessEntry base entry) state.buffers }

        "805" ->
            case accessListTarget knownChannels message of
                Nothing ->
                    AccessNoChange

                Just key ->
                    let
                        committed =
                            Maybe.withDefault [] (Dict.get key state.buffers)

                        next =
                            { state
                                | buffers = Dict.remove key state.buffers
                                , loading = Set.remove key state.loading
                            }
                    in
                    if Set.member key knownChannels then
                        if not (Dict.member key next.lists) && Dict.size next.lists >= maxAccessListChannels then
                            -- New bucket past the map cap: the oracle evicts
                            -- the oldest-inserted channel (insertion order an
                            -- Elm `Dict` does not keep), so the fail-closed
                            -- mirror refuses the commit and keeps the cap —
                            -- the buffer still drains and loading still clears.
                            AccessUpdated next

                        else
                            AccessUpdated { next | lists = Dict.insert key committed next.lists }

                    else
                        AccessUpdated next

        "775" ->
            case ( paramAt 1 message.params, paramAt 2 message.params ) of
                ( Just ch, Just mask ) ->
                    if String.isEmpty ch || String.isEmpty mask then
                        AccessNoChange

                    else
                        AccessServiceNote
                            { kind = "Channel"
                            , text = String.trim (ch ++ " ACCESS " ++ mask ++ " " ++ Maybe.withDefault "" (paramAt 3 message.params))
                            }

                _ ->
                    AccessNoChange

        "776" ->
            case paramAt 1 message.params of
                Just ch ->
                    if String.isEmpty ch then
                        AccessServiceNote { kind = "Channel", text = "Access list complete" }

                    else
                        AccessServiceNote { kind = "Channel", text = ch ++ " access list complete" }

                Nothing ->
                    AccessServiceNote { kind = "Channel", text = "Access list complete" }

        _ ->
            AccessNoChange


{-| 801/802 row target: params are `[me, #chan, LEVEL, mask]`.
-}
accessRowTarget : Set String -> Wire.IrcMessage -> Maybe String
accessRowTarget knownChannels message =
    case normalizeBanChannel (paramAt 1 message.params) of
        Nothing ->
            Nothing

        Just key ->
            if Set.member key knownChannels then
                Just key

            else
                Nothing


accessListTarget : Set String -> Wire.IrcMessage -> Maybe String
accessListTarget knownChannels message =
    case normalizeBanChannel (paramAt 1 message.params) of
        Nothing ->
            Nothing

        Just key ->
            if Set.member key knownChannels then
                Just key

            else
                Nothing


normalizeBanChannel : Maybe String -> Maybe String
normalizeBanChannel raw =
    case raw of
        Nothing ->
            Nothing

        Just value ->
            if String.isEmpty value then
                Nothing

            else
                Just (String.toLower value)


paramAt : Int -> List String -> Maybe String
paramAt index params =
    List.head (List.drop index params)



-- ── PROP registry ────────────────────────────────────────────────────


type alias PropState =
    { channelProps : Dict String (Dict String String)
    , userProps : Dict String (Dict String String)
    , synced : Set String
    }


blankPropState : PropState
blankPropState =
    { channelProps = Dict.empty, userProps = Dict.empty, synced = Set.empty }


normalizePropertyTarget : Maybe String -> Maybe String
normalizePropertyTarget raw =
    case raw of
        Nothing ->
            Nothing

        Just value ->
            if String.isEmpty value || String.length value > 512 then
                Nothing

            else if String.startsWith ":" value || String.contains "," value then
                Nothing

            else if isUnsafeKey (String.toLower value) then
                Nothing

            else
                Just value


normalizePropertyName : Maybe String -> Maybe String
normalizePropertyName raw =
    case raw of
        Nothing ->
            Nothing

        Just value ->
            if String.isEmpty value || String.length value > maxLivePropKeyLength then
                Nothing

            else if String.any (\c -> c <= ' ' || Char.toCode c == 127) value then
                Nothing

            else if isUnsafeKey (String.toLower value) then
                Nothing

            else
                Just value


isUnsafeKey : String -> Bool
isUnsafeKey key =
    key == "__proto__" || key == "prototype" || key == "constructor"


boundedPropertyValue : String -> String
boundedPropertyValue value =
    trimLoneSurrogate (String.left maxLivePropValueLength value)


trimLoneSurrogate : String -> String
trimLoneSurrogate text =
    case List.reverse (String.toList text) of
        last :: _ ->
            let
                code =
                    Char.toCode last
            in
            if code >= 0xD800 && code <= 0xDBFF then
                String.dropRight 1 text

            else
                text

        [] ->
            text


{-| Bounded upsert into one registry. `deleteEmpty` mirrors the
oracle's 818 path (`False`: 818 never deletes); the setter path uses
`True`.
-}
updateBoundedProperties : Dict String (Dict String String) -> String -> String -> String -> Bool -> Maybe (Dict String (Dict String String))
updateBoundedProperties source targetKey name value deleteEmpty =
    let
        existing =
            Maybe.withDefault Dict.empty (Dict.get targetKey source)
    in
    if deleteEmpty && String.isEmpty value then
        if not (Dict.member name existing) then
            Just source

        else
            let
                pruned =
                    Dict.remove name existing
            in
            if Dict.isEmpty pruned then
                Just (Dict.remove targetKey source)

            else
                Just (Dict.insert targetKey pruned source)

    else if not (Dict.member targetKey source) && Dict.size source >= maxLivePropTargets then
        Nothing

    else if not (Dict.member name existing) && Dict.size existing >= maxLivePropKeys then
        Nothing

    else
        Just (Dict.insert targetKey (Dict.insert name value existing) source)


{-| Fold 818 (row) / 819 (snapshot complete). Channel-vs-user split
follows the oracle's `isChan` on the advertised chantypes.
-}
foldPropLine : String -> PropState -> Wire.IrcMessage -> PropState
foldPropLine chantypes state message =
    case message.command of
        "818" ->
            case ( normalizePropertyTarget (paramAt 1 message.params), normalizePropertyName (paramAt 2 message.params) ) of
                ( Just target, Just name ) ->
                    let
                        key =
                            String.toLower target

                        value =
                            boundedPropertyValue (Maybe.withDefault "" (paramAt 3 message.params))
                    in
                    if isChanTarget chantypes target then
                        case updateBoundedProperties state.channelProps key name value False of
                            Just next ->
                                { state | channelProps = next }

                            Nothing ->
                                state

                    else
                        case updateBoundedProperties state.userProps key name value False of
                            Just next ->
                                { state | userProps = next }

                            Nothing ->
                                state

                _ ->
                    state

        "819" ->
            case normalizePropertyTarget (paramAt 1 message.params) of
                Just target ->
                    if isChanTarget chantypes target then
                        { state | synced = Set.insert (String.toLower target) state.synced }

                    else
                        state

                Nothing ->
                    state

        _ ->
            state


{-| Fold a live `PROP <target> <name> :<value>` broadcast (mirroring
the oracle arm: same bounded props update as 818 with params shifted
one left, channel-vs-user split on the advertised chantypes; the
channel AI-policy projection stays oracle-side until that slice
lands, so this fold owns props only and the caller owns activity).
-}
foldLivePropLine : String -> PropState -> Wire.IrcMessage -> PropState
foldLivePropLine chantypes state message =
    if message.command /= "PROP" then
        state

    else
        case ( normalizePropertyTarget (paramAt 0 message.params), normalizePropertyName (paramAt 1 message.params) ) of
            ( Just target, Just name ) ->
                let
                    key =
                        String.toLower target

                    value =
                        boundedPropertyValue (Maybe.withDefault "" (paramAt 2 message.params))
                in
                if isChanTarget chantypes target then
                    case updateBoundedProperties state.channelProps key name value False of
                        Just next ->
                            { state | channelProps = next }

                        Nothing ->
                            state

                else
                    case updateBoundedProperties state.userProps key name value False of
                        Just next ->
                            { state | userProps = next }

                        Nothing ->
                            state

            _ ->
                state


isChanTarget : String -> String -> Bool
isChanTarget chantypes target =
    case String.uncons target of
        Just ( first, _ ) ->
            String.contains (String.fromChar first) chantypes

        Nothing ->
            False



-- ── WHISPER ──────────────────────────────────────────────────────────


type WhisperFold
    = WhisperNoChange
    | WhisperReceived { channel : String, from : String, body : String }


{-| `:nick!u@h WHISPER #chan :text`. Self-echoes never render (the
oracle breaks before allocating); the caller assigns ids and
highlights.
-}
foldWhisperLine : String -> Wire.IrcMessage -> WhisperFold
foldWhisperLine ourNick message =
    if message.command /= "WHISPER" then
        WhisperNoChange

    else
        case message.params of
            channel :: body :: _ ->
                let
                    sender =
                        Maybe.withDefault "" message.nick
                in
                if String.isEmpty sender || String.toLower sender == String.toLower ourNick then
                    WhisperNoChange

                else
                    WhisperReceived { channel = channel, from = sender, body = body }

            _ ->
                WhisperNoChange



-- ── Builders ─────────────────────────────────────────────────────────


wireToken : String -> Maybe String
wireToken value =
    if String.isEmpty value || String.length value > 512 then
        Nothing

    else if String.any (\c -> c <= ' ' || Char.toCode c == 127) value then
        Nothing

    else
        Just value


wireText : String -> Maybe String
wireText value =
    if String.isEmpty value then
        Nothing

    else if String.any (\c -> c == '\r' || c == '\n' || Char.toCode c == 0) value then
        Nothing

    else
        Just value


build : String -> List (Maybe String) -> Maybe String
build command args =
    let
        collect =
            List.foldr
                (\arg acc ->
                    case ( arg, acc ) of
                        ( Just a, Just rest ) ->
                            Just (a :: rest)

                        _ ->
                            Nothing
                )
                (Just [])
    in
    Maybe.map (Wire.formatIrcLine command) (collect args)


ircxEnable : Maybe String -> Maybe String
ircxEnable version =
    case version of
        Nothing ->
            Just (Wire.formatIrcLine "IRCX" [])

        Just v ->
            Maybe.map (\x -> Wire.formatIrcLine "IRCX" [ x ]) (wireToken v)


ircxDisable : String
ircxDisable =
    Wire.formatIrcLine "IRCX" [ "OFF" ]


isircxQuery : String
isircxQuery =
    Wire.formatIrcLine "ISIRCX" []


type alias Ircx800 =
    { state : Maybe String
    , raw : List String
    }


{-| Tolerant `800 RPL_IRCX` capture: first param names the state, the
rest ride along verbatim (the TS client never parsed 800; the record
keeps the shape open without inventing fields).
-}
parseIrcx800 : List String -> Ircx800
parseIrcx800 params =
    { state = List.head (List.drop 1 params)
    , raw = params
    }


{-| DATA/REQUEST/REPLY tag: `[A-Za-z][A-Za-z0-9.]{0,14}`.
-}
validateDataTag : String -> Maybe String
validateDataTag tag =
    let
        chars =
            String.toList tag
    in
    case chars of
        first :: rest ->
            if Char.isAlpha first && List.length rest <= 14 && List.all (\c -> Char.isAlphaNum c || c == '.') rest then
                Just tag

            else
                Nothing

        [] ->
            Nothing


sendData : String -> String -> String -> Maybe String
sendData target tag message =
    case ( wireToken target, validateDataTag tag, wireText message ) of
        ( Just t, Just g, Just m ) ->
            Just (Wire.formatIrcLine "DATA" [ t, g, m ])

        _ ->
            Nothing


sendRequest : String -> String -> String -> Maybe String
sendRequest target tag message =
    case ( wireToken target, validateDataTag tag, wireText message ) of
        ( Just t, Just g, Just m ) ->
            Just (Wire.formatIrcLine "REQUEST" [ t, g, m ])

        _ ->
            Nothing


sendReply : String -> String -> String -> Maybe String
sendReply target tag message =
    case ( wireToken target, validateDataTag tag, wireText message ) of
        ( Just t, Just g, Just m ) ->
            Just (Wire.formatIrcLine "REPLY" [ t, g, m ])

        _ ->
            Nothing


whisper : String -> List String -> String -> Maybe String
whisper channel nicks message =
    if List.isEmpty nicks then
        Nothing

    else
        case ( wireToken channel, wireText message ) of
            ( Just c, Just m ) ->
                let
                    joined =
                        String.join "," nicks
                in
                case wireToken joined of
                    Just ns ->
                        Just (Wire.formatIrcLine "WHISPER" [ c, ns, m ])

                    Nothing ->
                        Nothing

            _ ->
                Nothing


propList : String -> Maybe String
propList entity =
    Maybe.map (\e -> Wire.formatIrcLine "PROP" [ e ]) (wireToken entity)


propGet : String -> List String -> Maybe String
propGet entity keys =
    if List.isEmpty keys then
        Nothing

    else
        build "PROP" (wireToken entity :: List.map (normalizePropertyName << Just) keys)


propSet : String -> String -> String -> Maybe String
propSet entity key value =
    case ( wireToken entity, normalizePropertyName (Just key), wireText value ) of
        ( Just e, Just k, Just v ) ->
            Just (Wire.formatIrcLine "PROP" [ e, k, v ])

        _ ->
            Nothing


accessList : String -> Maybe String -> Maybe String -> Maybe String
accessList channel level mask =
    case ( wireToken channel, level, mask ) of
        ( Just c, Nothing, _ ) ->
            Just (Wire.formatIrcLine "ACCESS" [ c, "LIST" ])

        ( Just c, Just l, Nothing ) ->
            case parseAccessLevel (Just l) of
                Just _ ->
                    Just (Wire.formatIrcLine "ACCESS" [ c, "LIST", String.toUpper (String.trim l) ])

                Nothing ->
                    Nothing

        ( Just c, Just l, Just m ) ->
            case ( parseAccessLevel (Just l), normalizeAccessMask (Just m) ) of
                ( Just _, Just norm ) ->
                    Just (Wire.formatIrcLine "ACCESS" [ c, "LIST", String.toUpper (String.trim l), norm ])

                _ ->
                    Nothing

        _ ->
            Nothing


accessAdd : String -> String -> String -> Maybe String -> Maybe String -> Maybe String
accessAdd channel level mask timeout reason =
    case ( wireToken channel, parseAccessLevel (Just level), normalizeAccessMask (Just mask) ) of
        ( Just c, Just _, Just norm ) ->
            let
                head =
                    [ c, "ADD", String.toUpper (String.trim level), norm ]
            in
            case timeout of
                Nothing ->
                    -- A bare trailing reason would parse as the timeout on
                    -- the wire; fail closed instead of mis-shaping it.
                    case reason of
                        Nothing ->
                            Just (Wire.formatIrcLine "ACCESS" head)

                        Just _ ->
                            Nothing

                Just t ->
                    case parseAccessDuration (Just t) of
                        Nothing ->
                            Nothing

                        Just n ->
                            case reason of
                                Nothing ->
                                    Just (Wire.formatIrcLine "ACCESS" (head ++ [ String.fromInt n ]))

                                Just r ->
                                    case wireText r of
                                        Just text ->
                                            Just (Wire.formatIrcLine "ACCESS" (head ++ [ String.fromInt n, text ]))

                                        Nothing ->
                                            Nothing

        _ ->
            Nothing


accessDelete : String -> String -> String -> Maybe String
accessDelete channel level mask =
    case ( wireToken channel, parseAccessLevel (Just level), normalizeAccessMask (Just mask) ) of
        ( Just c, Just _, Just norm ) ->
            Just (Wire.formatIrcLine "ACCESS" [ c, "DELETE", String.toUpper (String.trim level), norm ])

        _ ->
            Nothing


accessClear : String -> Maybe String -> Maybe String
accessClear channel level =
    case wireToken channel of
        Nothing ->
            Nothing

        Just c ->
            case level of
                Nothing ->
                    Just (Wire.formatIrcLine "ACCESS" [ c, "CLEAR" ])

                Just l ->
                    case parseAccessLevel (Just l) of
                        Just _ ->
                            Just (Wire.formatIrcLine "ACCESS" [ c, "CLEAR", String.toUpper (String.trim l) ])

                        Nothing ->
                            Nothing


listx : Maybe String -> Maybe String
listx filter =
    case filter of
        Nothing ->
            Just (Wire.formatIrcLine "LISTX" [])

        Just f ->
            Maybe.map (\x -> Wire.formatIrcLine "LISTX" [ x ]) (wireText f)

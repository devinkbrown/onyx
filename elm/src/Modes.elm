module Modes exposing
    ( ArgGroups
    , ChannelModeState
    , ExtBan
    , ModexKind(..)
    , ModexSpec
    , ModexTarget
    , ResolvedRole
    , UserModeAccess(..)
    , applyChannelModeDelta
    , defaultChanGroups
    , defaultModeToPrefix
    , defaultPrefixToMode
    , compareNicks
    , groupLabelFor
    , highestStatusMode
    , modeConsumesArg
    , buildExtBan
    , buildModexQuery
    , extBanTypeLabel
    , extBanTypes
    , letterToModexName
    , lookupModexName
    , maxModexChanges
    , maxModexNameBytes
    , maxModexTargetBytes
    , modexTable
    , parseChannelModeString
    , parseChanGroups
    , parseExtBan
    , parseModexListRow
    , parseModexTarget
    , resolveRole
    , roleSequence
    , statusRank
    , userModeAccess
    )

{-| Channel/member/user modes — Elm port of the data-driven mode logic in
`src/lib/store/store.ts` (`modeConsumesArg`, `applyChannelModeDelta`,
`parseChannelModeString`, `STATUS_RANK`, `selectOwnPrefix`) plus the
ISUPPORT parsers in `src/lib/irc/client.ts` (`parseIsupportChannelModes`)
and `Wire.parsePrefix` defaults.

Authoritative tables live in `modes.md` (live server source) and
`ONYX_SERVER_PROTOCOL.md` §8 (corrected 2026-10-04). Client folds stay
data-driven off the advertised `CHANMODES` groups and the learned `PREFIX`
maps — never hardcoded guesses — so exotic-but-legal servers degrade
gracefully.

New surface vs the TS client (which has no equivalent): extban shape
validation and the `UserModeAccess` catalog. Everything else mirrors the
oracle line for line.

-}

import Dict exposing (Dict)
import Set exposing (Set)



-- member status ladder


{-| Status-mode rank. Higher wins: Y network-oper > Q founder > q owner >
legacy a admin > o op > legacy h halfop > v voice. `a`/`h` never arrive
as Onyx Server status modes (kept for foreign-network parity with the
TS `STATUS_RANK` table).
-}
statusRank : Char -> Int
statusRank mode =
    case mode of
        'Y' ->
            7

        'Q' ->
            6

        'q' ->
            5

        'a' ->
            4

        'o' ->
            3

        'h' ->
            2

        'v' ->
            1

        _ ->
            0


{-| A member's resolved display role — Elm port of `resolveRole` in
`src/lib/memberGroups.ts`. `sort` doubles as the render rank.
-}
type alias ResolvedRole =
    { key : String
    , label : String
    , symbol : String
    , sort : Int
    }


{-| Conventional named ladder in fixed rank order (highest first), used
as-is when the learned PREFIX map has nothing to say about a member's
modes. Each entry carries the oracle `NAMED_ROLES` key, role label,
fallback symbol, and fixed sort.
-}
type alias NamedRole =
    { mode : Char
    , key : String
    , label : String
    , fallback : Char
    , sort : Int
    }


namedRoles : List NamedRole
namedRoles =
    [ { mode = 'Y', key = "netop", label = "Network Oper", fallback = '*', sort = 0 }
    , { mode = 'Q', key = "founder", label = "Founder", fallback = '!', sort = 1 }
    , { mode = 'q', key = "owner", label = "Owner", fallback = '.', sort = 2 }
    , { mode = 'a', key = "admin", label = "Admin", fallback = '&', sort = 3 }
    , { mode = 'o', key = "op", label = "Op", fallback = '@', sort = 4 }
    , { mode = 'h', key = "halfop", label = "Half-op", fallback = '%', sort = 5 }
    , { mode = 'v', key = "voice", label = "Voice", fallback = '+', sort = 6 }
    ]


{-| Rendered top-to-bottom group order; mirrors `ROLE_SEQUENCE`. -}
roleSequence : List String
roleSequence =
    [ "netop", "founder", "owner", "admin", "op", "halfop", "voice", "member" ]


{-| Section heading per role key; mirrors `GROUP_LABELS`. -}
groupLabelFor : String -> String
groupLabelFor key =
    case key of
        "netop" ->
            "Network Operators"

        "founder" ->
            "Founders"

        "owner" ->
            "Owners"

        "admin" ->
            "Admins"

        "op" ->
            "Ops"

        "halfop" ->
            "Half-ops"

        "voice" ->
            "Voice"

        _ ->
            "Members"


{-| Within-group member ordering. The oracle sorts with
`nick.localeCompare(nick)` (runtime default locale) in
`src/lib/memberGroups.ts`; IRC nicks are a small ASCII charset, so mirror
its primary + tertiary semantics deterministically: compare case-folded
(case-insensitive base order, digits before letters as in both engines),
and on a fold-tie order lowercase-first, matching ICU tertiary
(verified: `localeCompare('alice', 'Alice')` is `-1`, lowercase first).
Documented edge: punctuation collation order differs by locale and ICU
version (observed Node ICU: `a_b < a-b < ab`; codepoint order would put
`a-b` first), so exact parity is undefinable — the oracle itself varies by
user locale there — and a total deterministic order wins.
-}
compareNicks : String -> String -> Order
compareNicks a b =
    case compare (String.toLower a) (String.toLower b) of
        EQ ->
            compare (invertAsciiCase a) (invertAsciiCase b)

        other ->
            other


invertAsciiCase : String -> String
invertAsciiCase =
    String.map
        (\c ->
            if Char.isLower c then
                Char.toUpper c

            else if Char.isUpper c then
                Char.toLower c

            else
                c
        )


{-| Resolve a member's highest role. The learned PREFIX declaration
order wins first (its first letter the member holds is the
highest-precedence one, so exotic letters rank instead of dropping);
a letter the named ladder does not know still resolves to `member`
with the learned symbol. Falls back to the named ladder when the
learned map is silent, and to plain `member` when nothing matches.
-}
resolveRole : Set Char -> List Char -> Dict Char Char -> ResolvedRole
resolveRole modes order modeToPrefix =
    case firstOrderedHit modes order 0 modeToPrefix of
        Just role ->
            role

        Nothing ->
            case firstNamedHit modes modeToPrefix namedRoles of
                Just role ->
                    role

                Nothing ->
                    { key = "member", label = "Member", symbol = "", sort = 7 }


firstOrderedHit : Set Char -> List Char -> Int -> Dict Char Char -> Maybe ResolvedRole
firstOrderedHit modes order index modeToPrefix =
    case order of
        [] ->
            Nothing

        mode :: rest ->
            if Set.member mode modes then
                Just (roleFor mode index modeToPrefix)

            else
                firstOrderedHit modes rest (index + 1) modeToPrefix


firstNamedHit : Set Char -> Dict Char Char -> List NamedRole -> Maybe ResolvedRole
firstNamedHit modes modeToPrefix entries =
    case entries of
        [] ->
            Nothing

        named :: rest ->
            if Set.member named.mode modes then
                Just { key = named.key, label = named.label, symbol = symbolFor modeToPrefix named.mode (Just named.fallback), sort = named.sort }

            else
                firstNamedHit modes modeToPrefix rest


roleFor : Char -> Int -> Dict Char Char -> ResolvedRole
roleFor mode index modeToPrefix =
    case List.filter (\named -> named.mode == mode) namedRoles of
        named :: _ ->
            { key = named.key, label = named.label, symbol = symbolFor modeToPrefix mode (Just named.fallback), sort = index }

        [] ->
            { key = "member", label = "Member", symbol = symbolFor modeToPrefix mode Nothing, sort = index }


symbolFor : Dict Char Char -> Char -> Maybe Char -> String
symbolFor modeToPrefix mode fallback =
    case Dict.get mode modeToPrefix of
        Just prefix ->
            String.fromChar prefix

        Nothing ->
            case fallback of
                Just fb ->
                    String.fromChar fb

                Nothing ->
                    ""


{-| Highest-ranked status letter held, or `Nothing` for plain members. -}
highestStatusMode : List Char -> Maybe Char
highestStatusMode modes =
    List.foldl
        (\m best ->
            case best of
                Nothing ->
                    if statusRank m > 0 then
                        Just m

                    else
                        Nothing

                Just b ->
                    if statusRank m > statusRank b then
                        Just m

                    else
                        best
        )
        Nothing
        modes


{-| Server default maps for `PREFIX=(YQqov)*!.@+`, used before 005 arrives.
Mirrors `client.ts` defaults; overwritten verbatim from 005 on connect.
-}
defaultModeToPrefix : Dict Char Char
defaultModeToPrefix =
    Dict.fromList
        [ ( 'Y', '*' )
        , ( 'Q', '!' )
        , ( 'q', '.' )
        , ( 'o', '@' )
        , ( 'v', '+' )
        ]


defaultPrefixToMode : Dict Char Char
defaultPrefixToMode =
    Dict.fromList
        [ ( '*', 'Y' )
        , ( '!', 'Q' )
        , ( '.', 'q' )
        , ( '@', 'o' )
        , ( '+', 'v' )
        ]



-- user-mode catalog


{-| Who may carry a user mode. `SelfOnly` = own `MODE <ownnick>`;
`SelfAndOper` = self plus the oper cross-user path (`+P` media path,
`+j` privilege-gated override); `OperOnly` = oper cross-user use alone
(`+z` GAG, `+M` media deny); `ServerOnly` = daemon-derived, never set
over the wire by clients.
-}
type UserModeAccess
    = SelfOnly
    | SelfAndOper
    | OperOnly
    | ServerOnly


{-| Policy per `modes.md`. `Nothing` = unknown letter (ignored like the
server's self-user handler ignores unknown letters).
-}
userModeAccess : Char -> Maybe UserModeAccess
userModeAccess mode =
    case mode of
        'i' ->
            Just SelfOnly

        'B' ->
            Just SelfOnly

        'D' ->
            Just SelfOnly

        'g' ->
            Just SelfOnly

        'C' ->
            Just SelfOnly

        'R' ->
            Just SelfOnly

        'p' ->
            Just SelfOnly

        'Q' ->
            Just SelfOnly

        'H' ->
            Just SelfOnly

        'P' ->
            Just SelfAndOper

        'j' ->
            Just SelfAndOper

        'z' ->
            Just OperOnly

        'M' ->
            Just OperOnly

        'o' ->
            Just ServerOnly

        'r' ->
            Just ServerOnly

        'x' ->
            Just ServerOnly

        'a' ->
            Just ServerOnly

        _ ->
            Nothing



-- CHANMODES groups + arg consumption


{-| Advertised `CHANMODES` classes: list modes (A), param-always (B),
param-on-set (C). D flags are everything else.
-}
type alias ArgGroups =
    { lists : String
    , alwaysArg : String
    , setOnly : String
    }


{-| Onyx Server default: `beIZ,k,lfj,…`. -}
defaultChanGroups : ArgGroups
defaultChanGroups =
    { lists = "beIZ", alwaysArg = "k", setOnly = "lfj" }


{-| Strict ISUPPORT `CHANMODES` parse: exactly 4 comma groups, each ≤64
ASCII letters, globally duplicate-free. Mirrors
`parseIsupportChannelModes` (returns `Nothing` on any violation so the
caller keeps its last known-good table).
-}
parseChanGroups : String -> Maybe ArgGroups
parseChanGroups value =
    case String.split "," value of
        [ lists, alwaysArg, setOnly, flags ] ->
            -- All four groups are validated (length, alphabet, global
            -- uniqueness) exactly like the oracle; only the first three
            -- drive arg consumption. D flags are everything else.
            let
                allLetters =
                    lists ++ alwaysArg ++ setOnly ++ flags
            in
            if List.any (\g -> String.length g > 64) [ lists, alwaysArg, setOnly, flags ] then
                Nothing

            else if not (List.all isAsciiLetters (String.toList allLetters)) then
                Nothing

            else if Set.size (Set.fromList (String.toList allLetters)) /= String.length allLetters then
                Nothing

            else
                Just { lists = lists, alwaysArg = alwaysArg, setOnly = setOnly }

        _ ->
            Nothing


isAsciiLetters : Char -> Bool
isAsciiLetters c =
    let
        code =
            Char.toCode c
    in
    (code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)


{-| Whether a mode letter consumes a parameter, derived from the
advertised groups and the status (PREFIX) modes. Status modes always
take a nick; list modes (A) always; param-always (B) always;
param-on-set (C) only when adding; flags (D) never.
-}
modeConsumesArg : ArgGroups -> Set Char -> Char -> Bool -> Bool
modeConsumesArg groups prefixModes letter adding =
    if Set.member letter prefixModes then
        True

    else if String.contains (String.fromChar letter) groups.lists then
        True

    else if String.contains (String.fromChar letter) groups.alwaysArg then
        True

    else if String.contains (String.fromChar letter) groups.setOnly then
        adding

    else
        False



-- stored channel-mode string


type alias ChannelModeState =
    { flags : List Char
    , key : Maybe String
    , limit : Maybe Int
    }


{-| Parse a stored mode string like `"+mntkl secret 50"` or `"imt 50"`
into flags + key/limit. Tolerant of a leading `+`, missing args, and
stray whitespace.
-}
parseChannelModeString : String -> ChannelModeState
parseChannelModeString modeStr =
    if String.isEmpty (String.trim modeStr) then
        { flags = [], key = Nothing, limit = Nothing }

    else
        let
            parts =
                String.words modeStr

            letters =
                String.toList (stripLeadingPlus (Maybe.withDefault "" (List.head parts)))

            args =
                Maybe.withDefault [] (List.tail parts)
        in
        parseModeLetters letters args { flags = [], key = Nothing, limit = Nothing }


stripLeadingPlus : String -> String
stripLeadingPlus text =
    case String.uncons text of
        Just ( '+', rest ) ->
            rest

        _ ->
            text


parseModeLetters : List Char -> List String -> ChannelModeState -> ChannelModeState
parseModeLetters letters args state =
    case letters of
        [] ->
            { state | flags = List.reverse state.flags }

        ch :: rest ->
            if ch == '+' || ch == '-' then
                parseModeLetters rest args state

            else if ch == 'k' then
                parseModeLetters rest (dropArg args)
                    { state
                        | flags = ch :: state.flags
                        , key = List.head args
                    }

            else if ch == 'l' then
                parseModeLetters rest (dropArg args)
                    { state
                        | flags = ch :: state.flags
                        , limit = Maybe.andThen parseIntPrefix (List.head args)
                    }
                -- NOTE: matches the oracle — an unparseable limit arg
                -- clears the stored limit (null), it does not keep it.

            else
                parseModeLetters rest args { state | flags = ch :: state.flags }


dropArg : List String -> List String
dropArg args =
    Maybe.withDefault [] (List.tail args)


{-| Decimal integer prefix (`Number.parseInt` without hex/octal legacy
shapes, which caps and mode args never advertise). -}
parseIntPrefix : String -> Maybe Int
parseIntPrefix text =
    let
        trimmed =
            String.trimLeft text

        ( sign, rest ) =
            case String.uncons trimmed of
                Just ( '+', tail ) ->
                    ( 1, tail )

                Just ( '-', tail ) ->
                    ( -1, tail )

                _ ->
                    ( 1, trimmed )

        digits =
            takeDigits (String.toList rest)
    in
    case digits of
        [] ->
            Nothing

        _ ->
            Just (sign * List.foldl (\d acc -> acc * 10 + d) 0 digits)


takeDigits : List Char -> List Int
takeDigits chars =
    List.reverse (takeDigitsGo chars [])


takeDigitsGo : List Char -> List Int -> List Int
takeDigitsGo chars acc =
    case chars of
        [] ->
            acc

        c :: rest ->
            let
                code =
                    Char.toCode c
            in
            if code >= 0x30 && code <= 0x39 then
                takeDigitsGo rest ((code - 0x30) :: acc)

            else
                acc


{-| Apply a MODE delta (e.g. `"+mk-l"` with args `["secret"]`) to a
stored mode string, returning the canonical `"+<flags> <key> <limit>"`
form (or `""` when no flags remain).

Only plain channel modes are tracked — status modes live per-user and
list modes have their own state. `k`/`l` rebind key/limit; removing
them clears the stored value.
-}
applyChannelModeDelta : String -> String -> List String -> ArgGroups -> Set Char -> String
applyChannelModeDelta current modeStr modeArgs groups prefixModes =
    let
        state =
            parseChannelModeString current

        delta =
            applyDelta (String.toList modeStr) modeArgs True state groups prefixModes

        letters =
            delta.flags |> List.sort |> String.fromList

        suffix =
            [ if List.member 'k' delta.flags then
                Maybe.map (\k -> " " ++ k) delta.key

              else
                Nothing
            , if List.member 'l' delta.flags then
                Maybe.map (\l -> " " ++ String.fromInt l) delta.limit

              else
                Nothing
            ]
                |> List.filterMap identity
                |> String.concat
    in
    if String.isEmpty letters then
        ""

    else
        "+" ++ letters ++ suffix


applyDelta : List Char -> List String -> Bool -> ChannelModeState -> ArgGroups -> Set Char -> ChannelModeState
applyDelta letters args adding state groups prefixModes =
    case letters of
        [] ->
            state

        ch :: rest ->
            if ch == '+' then
                applyDelta rest args True state groups prefixModes

            else if ch == '-' then
                applyDelta rest args False state groups prefixModes

            else
                let
                    consumes =
                        modeConsumesArg groups prefixModes ch adding

                    arg =
                        if consumes then
                            List.head args

                        else
                            Nothing

                    remaining =
                        if consumes then
                            dropArg args

                        else
                            args
                in
                if Set.member ch prefixModes || String.contains (String.fromChar ch) groups.lists then
                    -- Status (per-user) and list modes are tracked elsewhere.
                    applyDelta rest remaining adding state groups prefixModes

                else if ch == 'k' then
                    if adding then
                        applyDelta rest remaining adding
                            { state
                                | flags = addFlag ch state.flags
                                , key = case arg of
                                    Just a ->
                                        Just a

                                    Nothing ->
                                        state.key
                            }
                            groups
                            prefixModes

                    else
                        applyDelta rest remaining adding
                            { flags = removeFlag ch state.flags, key = Nothing, limit = state.limit }
                            groups
                            prefixModes

                else if ch == 'l' then
                    if adding then
                        applyDelta rest remaining adding
                            { state
                                | flags = addFlag ch state.flags
                                , limit = case Maybe.andThen parseIntPrefix arg of
                                    Just n ->
                                        Just n

                                    Nothing ->
                                        state.limit
                            }
                            groups
                            prefixModes

                    else
                        applyDelta rest remaining adding
                            { flags = removeFlag ch state.flags, key = state.key, limit = Nothing }
                            groups
                            prefixModes

                else if adding then
                    applyDelta rest remaining adding
                        { state | flags = addFlag ch state.flags }
                        groups
                        prefixModes

                else
                    applyDelta rest remaining adding
                        { state | flags = removeFlag ch state.flags }
                        groups
                        prefixModes


addFlag : Char -> List Char -> List Char
addFlag ch flags =
    if List.member ch flags then
        flags

    else
        ch :: flags


removeFlag : Char -> List Char -> List Char
removeFlag ch flags =
    List.filter (\f -> f /= ch) flags



-- extbans


type alias ExtBan =
    { negated : Bool
    , banType : Char
    , mask : String
    }


extBanTypes : String
extBanTypes =
    "acgmorz"


{-| Validate an extban mask (`$a:<account>`, `$c:<#chan>`, `$g:<country>`,
`$m:<mute-mask>`, `$r:<realname>`, `$z:<tls-fingerprint>` (bare `$z`
matches any TLS client), `$o:<class>` (bare `$o` matches any oper),
with `$~…` negation). Mirrors `extban.zig` `parseTyped`: every type
but `o`/`z` requires a non-empty `:<pattern>`; `$o:`/`$z:` with an
empty pattern are rejected, and only `o`/`z` admit the bare form.
Nested `$~$…`/`$~:…` expressions have no `ExtBan` shape and stay
`Nothing`. New surface vs the TS client, which passes ban masks
through as opaque strings.
-}
parseExtBan : String -> Maybe ExtBan
parseExtBan mask =
    if not (String.startsWith "$" mask) then
        Nothing

    else
        let
            rest =
                String.dropLeft 1 mask

            ( negated, typed ) =
                case String.uncons rest of
                    Just ( '~', tail ) ->
                        ( True, tail )

                    _ ->
                        ( False, rest )
        in
        case String.uncons typed of
            Just ( banType, afterType ) ->
                if not (String.contains (String.fromChar banType) extBanTypes) then
                    Nothing

                else if String.isEmpty afterType && (banType == 'o' || banType == 'z') then
                    Just { negated = negated, banType = banType, mask = "" }

                else if not (String.startsWith ":" afterType) then
                    Nothing

                else
                    let
                        body =
                            String.dropLeft 1 afterType
                    in
                    if String.isEmpty body || String.length body > 256 then
                        Nothing

                    else if List.any isMaskBad (String.toList body) then
                        Nothing

                    else
                        Just { negated = negated, banType = banType, mask = body }

            Nothing ->
                Nothing


isMaskBad : Char -> Bool
isMaskBad c =
    let
        code =
            Char.toCode c
    in
    code <= 0x20 || code == 0x7F


{-| Human label per extban type for the builder select. -}
extBanTypeLabel : Char -> String
extBanTypeLabel banType =
    case banType of
        'a' ->
            "Account ($a:)"

        'c' ->
            "Channel ($c:)"

        'g' ->
            "Geo ($g:)"

        'm' ->
            "Mute ($m:)"

        'r' ->
            "Realname ($r:)"

        'z' ->
            "TLS ($z:)"

        'o' ->
            "Oper class ($o:)"

        _ ->
            "Unknown"


{-| Build an extban mask from builder parts (the UI half the TS
client never got: type + optional negation + pattern, validated
through the same shape rules by round-tripping `parseExtBan` —
`Nothing` means the builder shows invalid, never a guess). -}
buildExtBan : Bool -> Char -> String -> Maybe String
buildExtBan negated banType pattern =
    let
        mask =
            "$"
                ++ (if negated then
                        "~"

                    else
                        ""
                   )
                ++ String.fromChar banType
                ++ (if String.isEmpty pattern then
                        ""

                    else
                        ":" ++ pattern
                   )
    in
    case parseExtBan mask of
        Just _ ->
            Just mask

        Nothing ->
            Nothing


-- IRCX MODEX named modes


{-| Which state a MODEX name controls (mirroring `ModeKind`:
channel flags, visibility selectors, and per-member statuses). -}
type ModexKind
    = ModexChannel
    | ModexVisibility
    | ModexMember


{-| One MODEX name-table row (mirroring `ModeSpec`: canonical
UPPER spelling, the IRC letter it stands for — `Nothing` for the
letterless `PUBLIC` visibility — the kind gate, the oper-only
mark, and the member status prefix). -}
type alias ModexSpec =
    { name : String
    , letter : Maybe Char
    , kind : ModexKind
    , requiresOper : Bool
    , statusPrefix : Maybe Char
    }


{-| The 25-row MODEX name table, verbatim from
`src/proto/ircx_modex.zig` (`mode_table`). -}
modexTable : List ModexSpec
modexTable =
    [ { name = "PUBLIC", letter = Nothing, kind = ModexVisibility, requiresOper = False, statusPrefix = Nothing }
    , { name = "PRIVATE", letter = Just 'p', kind = ModexVisibility, requiresOper = False, statusPrefix = Nothing }
    , { name = "HIDDEN", letter = Just 'h', kind = ModexVisibility, requiresOper = False, statusPrefix = Nothing }
    , { name = "SECRET", letter = Just 's', kind = ModexVisibility, requiresOper = False, statusPrefix = Nothing }
    , { name = "MODERATED", letter = Just 'm', kind = ModexChannel, requiresOper = False, statusPrefix = Nothing }
    , { name = "TOPICOP", letter = Just 't', kind = ModexChannel, requiresOper = False, statusPrefix = Nothing }
    , { name = "INVITEONLY", letter = Just 'i', kind = ModexChannel, requiresOper = False, statusPrefix = Nothing }
    , { name = "NOEXTERN", letter = Just 'n', kind = ModexChannel, requiresOper = False, statusPrefix = Nothing }
    , { name = "KNOCK", letter = Just 'u', kind = ModexChannel, requiresOper = False, statusPrefix = Nothing }
    , { name = "AUTHONLY", letter = Just 'a', kind = ModexChannel, requiresOper = False, statusPrefix = Nothing }
    , { name = "NOFORMAT", letter = Just 'f', kind = ModexChannel, requiresOper = False, statusPrefix = Nothing }
    , { name = "CLONEABLE", letter = Just 'd', kind = ModexChannel, requiresOper = False, statusPrefix = Nothing }
    , { name = "CLONE", letter = Just 'E', kind = ModexChannel, requiresOper = True, statusPrefix = Nothing }
    , { name = "REGISTERED", letter = Just 'r', kind = ModexChannel, requiresOper = True, statusPrefix = Nothing }
    , { name = "SERVICE", letter = Just 'z', kind = ModexChannel, requiresOper = True, statusPrefix = Nothing }
    , { name = "AUDITORIUM", letter = Just 'x', kind = ModexChannel, requiresOper = False, statusPrefix = Nothing }
    , { name = "NOWHISPER", letter = Just 'w', kind = ModexChannel, requiresOper = False, statusPrefix = Nothing }
    , { name = "OPMODERATE", letter = Just 'U', kind = ModexChannel, requiresOper = False, statusPrefix = Nothing }
    , { name = "NOCOMICDATA", letter = Just 'V', kind = ModexChannel, requiresOper = False, statusPrefix = Nothing }
    , { name = "FREETARGET", letter = Just 'F', kind = ModexChannel, requiresOper = False, statusPrefix = Nothing }
    , { name = "DISFORWARD", letter = Just 'D', kind = ModexChannel, requiresOper = False, statusPrefix = Nothing }
    , { name = "FOUNDER", letter = Just 'Q', kind = ModexMember, requiresOper = False, statusPrefix = Just '~' }
    , { name = "OWNER", letter = Just 'q', kind = ModexMember, requiresOper = False, statusPrefix = Just '.' }
    , { name = "HOST", letter = Just 'o', kind = ModexMember, requiresOper = False, statusPrefix = Just '@' }
    , { name = "VOICE", letter = Just 'v', kind = ModexMember, requiresOper = False, statusPrefix = Just '+' }
    ]


{-| MODEX wire budgets from `ircx_modex.zig` (`Params` defaults). -}
maxModexNameBytes : Int
maxModexNameBytes =
    64


maxModexTargetBytes : Int
maxModexTargetBytes =
    160


maxModexChanges : Int
maxModexChanges =
    16


{-| ASCII case-insensitive name lookup (mirroring `lookupName`:
1–64 ASCII-alpha bytes, then the table scan — unknown and
malformed names are `Nothing`, never a guess). -}
lookupModexName : String -> Maybe ModexSpec
lookupModexName raw =
    if String.isEmpty raw || String.length raw > maxModexNameBytes then
        Nothing

    else if not (String.all isAsciiAlphaChar raw) then
        Nothing

    else
        let
            needle =
                String.toUpper raw
        in
        List.filter (\spec -> spec.name == needle) modexTable
            |> List.head


{-| Map an IRC mode letter back to its canonical MODEX name
(mirroring `letterToName`; `PUBLIC` has no letter, so no letter
maps to it). -}
letterToModexName : Char -> Maybe String
letterToModexName letter =
    List.filter (\spec -> spec.letter == Just letter) modexTable
        |> List.head
        |> Maybe.map .name


isAsciiAlphaChar : Char -> Bool
isAsciiAlphaChar c =
    (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')


{-| A parsed MODEX target: `#channel` or `#channel,nick`
(mirroring `parseTarget`). -}
type alias ModexTarget =
    { channel : String
    , member : Maybe String
    }


{-| Parse a MODEX target (mirroring `parseTargetWith`: at most one
comma, channel 1–128 bytes starting with `#`, member 1–64 bytes
with no spaces/commas/controls, whole target within 160 bytes). -}
parseModexTarget : String -> Maybe ModexTarget
parseModexTarget raw =
    if String.isEmpty raw || String.length raw > maxModexTargetBytes then
        Nothing

    else
        case String.split "," raw of
            [ channel ] ->
                if validModexChannel channel then
                    Just { channel = channel, member = Nothing }

                else
                    Nothing

            [ channel, member ] ->
                if validModexChannel channel && validModexMember member then
                    Just { channel = channel, member = Just member }

                else
                    Nothing

            _ ->
                Nothing


validModexChannel : String -> Bool
validModexChannel channel =
    not (String.isEmpty channel)
        && String.length channel <= 128
        && String.startsWith "#" channel
        && not (String.contains " " channel)
        && not (String.any isModexControlChar channel)


validModexMember : String -> Bool
validModexMember member =
    not (String.isEmpty member)
        && String.length member <= 64
        && not (String.contains " " member)
        && not (String.contains "," member)
        && not (String.any isModexControlChar member)


isModexControlChar : Char -> Bool
isModexControlChar c =
    let
        code =
            Char.toCode c
    in
    code < 32 || code == 127


{-| Build a MODEX list query for a target (mirroring the query half
of `parseCommand`: a bare `MODEX <target>` with no change tokens
asks the server to list — `Nothing` for an unparseable target, so
the composer never sends a malformed query). -}
buildModexQuery : String -> Maybe String
buildModexQuery raw =
    case parseModexTarget (String.trim raw) of
        Just target ->
            Just
                ("MODEX "
                    ++ target.channel
                    ++ (case target.member of
                            Just member ->
                                "," ++ member

                            Nothing ->
                                ""
                       )
                )

        Nothing ->
            Nothing


{-| Split an 826 `RPL_MODEXLIST` trailing row into canonical names
(mirroring `writeModexList`: space-separated UPPER names — lookup
validates each token, so unknown tokens drop and the fold stores
only table names, never wire guesses). -}
parseModexListRow : String -> List String
parseModexListRow row =
    List.filterMap
        (\token ->
            case lookupModexName token of
                Just spec ->
                    Just spec.name

                Nothing ->
                    Nothing
        )
        (String.words row)

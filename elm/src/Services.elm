module Services exposing
    ( OfflineSendDecision(..)
    , WhoisCache
    , WhoisFold(..)
    , WhoisInfo
    , acceptEntry
    , accountInfo
    , accountSet
    , autojoin
    , away
    , beginWhois
    , blankWhoisCache
    , certAdd
    , certDel
    , certList
    , applyUserProfilePatch
    , blankUserProfile
    , channelService
    , decideOfflineSend
    , dropAccount
    , e2eeKeyAdd
    , e2eeKeyDel
    , e2eeKeyList
    , e2eeKeyStatus
    , foldWhoisLine
    , ghost
    , emptyUserProfilePatch
    , foldWhoisProfile
    , getUserProfileFrom
    , helpOp
    , helpTopic
    , isAdminOperRole
    , boundedNumber
    , groupCommand
    , identify
    , ison
    , listChannels
    , logout
    , maxUserProfiles
    , maxWhoisCacheEntries
    , maxWhoisChannels
    , maxWhoisSpecialNotes
    , maxWhoisTextLength
    , maxWhoxSelectorFields
    , maxWhoxTokenBytes
    , memo
    , monitor
    , normalizeProfileNick
    , recover
    , register
    , releaseNick
    , saslInfo
    , seen
    , setName
    , setUserProfileOn
    , sheetChannels
    , silenceEntry
    , keyTransparencyProof
    , keyTransparencyStatus
    , recoveryCodesClear
    , recoveryCodesGenerate
    , recoveryCodesLogin
    , recoveryCodesStatus
    , totpConfirm
    , totpDisable
    , totpEnroll
    , totpStatus
    , UserProfile
    , UserProfilePatch
    , userhost
    , verifyAccount
    , verifyCode
    , welcomeAdd
    , welcomeClear
    , welcomeShow
    , whox
    , whoxFields
    , vhost
    , vhostList
    , vhostUse
    , vhostClaim
    , vhostOff
    , monitorAdd
    , monitorRemove
    , monitorClear
    , who
    , whois
    , whowas
    )

{-| Account services, query commands, and the offline-send admission
rule — Elm port of the `Services` slice (`lib/store/store.ts`
account/WHOIS folds, `Account.tsx` wire shapes, protocol §7).

Builders return `Maybe String`: `Nothing` is a fail-closed refusal
(empty values, injected `CR`/`LF`/`NUL`, or whitespace inside a
single-token argument). Outbound lines use `Wire.formatIrcLine`, the
same shape `App.ComposerSend` emits.

Command names are `MEMO`/`CHANNEL` only — never historical aliases
(protocol §7: no `TEGAMI`, no ChanServ/NickServ pseudo-clients).

-}

import Dict exposing (Dict)
import Regex
import Set
import Wire


maxWhoisTextLength : Int
maxWhoisTextLength =
    4096


maxWhoisChannels : Int
maxWhoisChannels =
    256


maxWhoisChannelTokenLength : Int
maxWhoisChannelTokenLength =
    512


maxWhoisSpecialNotes : Int
maxWhoisSpecialNotes =
    12


maxWhoisCacheEntries : Int
maxWhoisCacheEntries =
    64


{-| WHOIS working set. `order` holds lowercase keys oldest-first so the
64-entry bound evicts the least-recently-touched sheet, mirroring the
oracle's insertion-ordered `Map` LRU refresh.
-}
type alias WhoisCache =
    { entries : Dict String WhoisInfo
    , order : List String
    }


type alias WhoisInfo =
    { nick : String
    , username : Maybe String
    , host : Maybe String
    , realname : Maybe String
    , server : Maybe String
    , serverInfo : Maybe String
    , isOper : Bool
    , operRole : Maybe String
    , idleSecs : Maybe Int
    , signOnTs : Maybe Int
    , channels : List String
    , account : Maybe String
    , special : Maybe String
    , specialNotes : List String
    , awayMessage : Maybe String
    , secureConnection : Maybe String
    , certfp : Maybe String
    , bot : Bool
    , realHost : Maybe String
    , loading : Bool
    , error : Maybe String
    }


type WhoisFold
    = NoChange
    | CacheUpdated WhoisCache
    | SelfOper { admin : Bool, cache : WhoisCache }
    | SelfAway Bool


blankWhoisCache : WhoisCache
blankWhoisCache =
    { entries = Dict.empty, order = [] }


freshWhois : String -> Bool -> WhoisInfo
freshWhois nick connected =
    { nick = nick
    , username = Nothing
    , host = Nothing
    , realname = Nothing
    , server = Nothing
    , serverInfo = Nothing
    , isOper = False
    , operRole = Nothing
    , idleSecs = Nothing
    , signOnTs = Nothing
    , channels = []
    , account = Nothing
    , special = Nothing
    , specialNotes = []
    , awayMessage = Nothing
    , secureConnection = Nothing
    , certfp = Nothing
    , bot = False
    , realHost = Nothing
    , loading = connected
    , error =
        if connected then
            Nothing

        else
            Just "Reconnect to request profile details."
    }


{-| Open a WHOIS sheet for a nick: normalize, evict down to the bound,
insert a fresh loading entry. Returns the `WHOIS nick nick` wire line
(double-nick form requests idle time, per the oracle) when connected.
-}
beginWhois : WhoisCache -> String -> Bool -> ( WhoisCache, Maybe String )
beginWhois cache nick connected =
    case normalizeNick nick of
        Nothing ->
            ( cache, Nothing )

        Just safe ->
            let
                key =
                    String.toLower safe

                without =
                    List.filter (\k -> k /= key) cache.order

                keptOrder =
                    pruneOrder without

                dropped =
                    List.filter (\k -> not (List.member k keptOrder)) cache.order

                next =
                    { entries =
                        Dict.insert key
                            (freshWhois safe connected)
                            (List.foldl Dict.remove cache.entries dropped)
                    , order = keptOrder ++ [ key ]
                    }
            in
            ( next
            , if connected then
                Just (Wire.formatIrcLine "WHOIS" [ safe, safe ])

              else
                Nothing
            )


pruneOrder : List String -> List String
pruneOrder order =
    List.drop (max 0 (List.length order - (maxWhoisCacheEntries - 1))) order


{-| Fold one inbound line into the WHOIS working set. Only lines whose
`params[1]` matches the active sheet nick (case-insensitive) patch the
cache, and only when a sheet entry already exists — exactly the
`_updateActiveWhois` null-guard, so unsolicited numerics (notably 301)
can never plant data.
-}
foldWhoisLine : WhoisCache -> { activeNick : String, ourNick : String } -> Wire.IrcMessage -> WhoisFold
foldWhoisLine cache ctx message =
    case message.command of
        "305" ->
            SelfAway False

        "306" ->
            SelfAway True

        "381" ->
            SelfOper { admin = isAdminOperRole (paramAt 1 message.params), cache = cache }

        _ ->
            foldWhoisNumeric cache ctx message


foldWhoisNumeric : WhoisCache -> { activeNick : String, ourNick : String } -> Wire.IrcMessage -> WhoisFold
foldWhoisNumeric cache ctx message =
    case activeTarget ctx.activeNick (paramAt 1 message.params) of
        Nothing ->
            NoChange

        Just safe ->
            let
                key =
                    String.toLower safe
            in
            case Dict.get key cache.entries of
                Nothing ->
                    NoChange

                Just current ->
                    case patchWhois ctx current message of
                        Nothing ->
                            NoChange

                        Just patched ->
                            let
                                updated =
                                    touchCache cache key patched
                            in
                            if message.command == "313" then
                                -- WHOIS on ourselves is the one place the
                                -- network states OUR role: an admin wording
                                -- promotes the local badge. Guarded on our
                                -- own nick so another oper's 313 never does.
                                if String.toLower safe == String.toLower ctx.ourNick && isAdminOperRole (whoisOperRole (boundedText (paramAt 2 message.params))) then
                                    SelfOper { admin = True, cache = updated }

                                else
                                    CacheUpdated updated

                            else
                                CacheUpdated updated


touchCache : WhoisCache -> String -> WhoisInfo -> WhoisCache
touchCache cache key patched =
    { entries = Dict.insert key patched cache.entries
    , order = List.filter (\k -> k /= key) cache.order ++ [ key ]
    }


activeTarget : String -> Maybe String -> Maybe String
activeTarget activeNick raw =
    case Maybe.andThen normalizeNick raw of
        Nothing ->
            Nothing

        Just safe ->
            if String.toLower safe == String.toLower activeNick then
                Just safe

            else
                Nothing


patchWhois : { activeNick : String, ourNick : String } -> WhoisInfo -> Wire.IrcMessage -> Maybe WhoisInfo
patchWhois ctx current message =
    case message.command of
        "311" ->
            Just
                { current
                    | username = boundedText (paramAt 2 message.params)
                    , host = boundedText (paramAt 3 message.params)
                    , realname = boundedText (paramAt 5 message.params)
                }

        "312" ->
            Just
                { current
                    | server = boundedText (paramAt 2 message.params)
                    , serverInfo = boundedText (paramAt 3 message.params)
                }

        "313" ->
            let
                role =
                    whoisOperRole (boundedText (paramAt 2 message.params))
            in
            Just { current | isOper = True, operRole = role }

        "317" ->
            Just
                { current
                    | idleSecs = Just (boundedNumber (paramAt 2 message.params))
                    , signOnTs = Just (boundedNumber (paramAt 3 message.params))
                }

        "318" ->
            Just { current | loading = False }

        "319" ->
            Just { current | channels = mergeChannels current.channels (boundedChannels (paramAt 2 message.params)) }

        "320" ->
            case Maybe.map String.trim (boundedText (paramAt 2 message.params)) of
                Just note ->
                    if String.isEmpty note then
                        Nothing

                    else
                        Just
                            { current
                                | special = Just note
                                , specialNotes = appendWhoisNote current.specialNotes note
                            }

                Nothing ->
                    Nothing

        "330" ->
            Just { current | account = boundedText (paramAt 2 message.params) }

        "338" ->
            Just { current | realHost = boundedText (paramAt 2 message.params) }

        "335" ->
            Just { current | bot = True }

        "671" ->
            case Maybe.map String.trim (boundedText (paramAt 2 message.params)) of
                Just secure ->
                    if String.isEmpty secure then
                        Nothing

                    else
                        Just { current | secureConnection = Just secure }

                Nothing ->
                    Nothing

        "276" ->
            case Maybe.map String.trim (boundedText (paramAt 2 message.params)) of
                Just fp ->
                    if String.isEmpty fp then
                        Nothing

                    else
                        Just { current | certfp = Just fp }

                Nothing ->
                    Nothing

        "301" ->
            case Maybe.map String.trim (boundedText (paramAt 2 message.params)) of
                Just awayText ->
                    Just { current | awayMessage = nonEmpty awayText }

                Nothing ->
                    Just { current | awayMessage = Nothing }

        _ ->
            Nothing


{-| 313 arrives as a sentence fragment; strip the leading copula and a
trailing period for badge-label use. The role wording stays the
network's.
-}
whoisOperRole : Maybe String -> Maybe String
whoisOperRole raw =
    case raw of
        Nothing ->
            Nothing

        Just text ->
            let
                stripped =
                    stripCopula (String.trim text)
                        |> stripTrailingPeriod
                        |> String.trim
            in
            nonEmpty stripped


stripCopula : String -> String
stripCopula text =
    case Regex.fromStringWith { caseInsensitive = True, multiline = False } "^is\\s+(?:an?|the)\\s+" of
        Nothing ->
            text

        Just re ->
            Regex.replace re (\_ -> "") text


stripTrailingPeriod : String -> String
stripTrailingPeriod text =
    if String.endsWith "." text then
        String.dropRight 1 text

    else
        text


isAdminOperRole : Maybe String -> Bool
isAdminOperRole raw =
    case raw of
        Nothing ->
            False

        Just text ->
            case Regex.fromStringWith { caseInsensitive = True, multiline = False } "\\badmin(?:istrator)?\\b" of
                Nothing ->
                    False

                Just re ->
                    Regex.contains re text


{-| 319 membership fragments merge across lines (replace would read as
"left every other channel"); unioned, order-stable, capped.
-}
mergeChannels : List String -> List String -> List String
mergeChannels current incoming =
    List.foldl
        (\c acc ->
            if List.member c acc then
                acc

            else
                acc ++ [ c ]
        )
        current
        incoming
        |> List.take maxWhoisChannels


appendWhoisNote : List String -> String -> List String
appendWhoisNote current note =
    if List.member note current then
        current

    else
        List.take maxWhoisSpecialNotes
            (List.drop (max 0 (List.length current + 1 - maxWhoisSpecialNotes)) current ++ [ note ])


paramAt : Int -> List String -> Maybe String
paramAt index params =
    List.head (List.drop index params)


nonEmpty : String -> Maybe String
nonEmpty text =
    if String.isEmpty text then
        Nothing

    else
        Just text


{-| Single-token nick validation: bounded, no whitespace/C0/DEL, no
leading colon, no comma.
-}
normalizeNick : String -> Maybe String
normalizeNick value =
    if String.isEmpty value || String.length value > 256 then
        Nothing

    else if String.startsWith ":" value || String.contains "," value then
        Nothing

    else if String.any (\c -> c <= ' ' || Char.toCode c == 127) value then
        Nothing

    else
        Just value


{-| 4096-char bound with trailing-lone-surrogate trim, mirroring the
oracle's UTF-16 cut guard.
-}
boundedText : Maybe String -> Maybe String
boundedText raw =
    case raw of
        Nothing ->
            Nothing

        Just text ->
            Just (trimLoneSurrogate (String.left maxWhoisTextLength text))


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


{-| Prefix-tolerant non-negative integer (`parseInt(value, 10)`
semantics: leading ASCII whitespace skipped, one optional sign,
leading digits win, and the result must be a non-negative safe
integer — anything else is 0, mirroring
`_boundedWhoisNumber`). Only the `c <= ' '` whitespace class is
skipped; exotic Unicode spaces stay a zero, which no server emits
in a numeric field.
-}
boundedNumber : Maybe String -> Int
boundedNumber raw =
    case raw of
        Nothing ->
            0

        Just text ->
            case parseLeadingInt (String.toList text) of
                Nothing ->
                    0

                Just n ->
                    if toFloat n <= maxSafeWhoisInt then
                        n

                    else
                        0


{-| Largest integer the wire may carry exactly (mirroring
`Number.isSafeInteger`). -}
maxSafeWhoisInt : Float
maxSafeWhoisInt =
    9007199254740991


parseLeadingInt : List Char -> Maybe Int
parseLeadingInt chars =
    case chars of
        [] ->
            Nothing

        c :: rest ->
            if c <= ' ' then
                parseLeadingInt rest

            else if c == '+' then
                digitsToInt rest

            else if c == '-' then
                -- A negative can never satisfy the non-negative
                -- gate, so it stays a zero without parsing further.
                Nothing

            else
                digitsToInt chars


digitsToInt : List Char -> Maybe Int
digitsToInt chars =
    case takeDigits chars of
        [] ->
            Nothing

        digits ->
            String.toInt (String.fromList digits)


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


boundedChannels : Maybe String -> List String
boundedChannels raw =
    case raw of
        Nothing ->
            []

        Just text ->
            String.words (Maybe.withDefault "" (boundedText (Just text)))
                |> List.filter (\c -> validWireToken c maxWhoisChannelTokenLength)
                |> List.take maxWhoisChannels


validWireToken : String -> Int -> Bool
validWireToken value maxLength =
    not (String.isEmpty value)
        && String.length value <= maxLength
        && not (String.any (\c -> c <= ' ' || Char.toCode c == 127) value)



-- ── Outbound builders ────────────────────────────────────────────────


{-| Single wire token: non-empty, no whitespace/C0/DEL (would split or
smuggle params).
-}
wireToken : String -> Maybe String
wireToken value =
    if validWireToken value 512 then
        Just value

    else
        Nothing


{-| Trailing free text: non-empty, never carrying CR/LF/NUL.
-}
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


buildSub : String -> String -> List (Maybe String) -> Maybe String
buildSub command sub args =
    build command (Just sub :: args)


register : String -> String -> String -> Maybe String
register account email password =
    case ( wireToken account, wireToken password ) of
        ( Just a, Just p ) ->
            if email == "*" then
                build "REGISTER" [ Just a, Just "*", Just p ]

            else
                case wireToken email of
                    Just e ->
                        build "REGISTER" [ Just a, Just e, Just p ]

                    Nothing ->
                        Nothing

        _ ->
            Nothing


verifyAccount : String -> Maybe String
verifyAccount token =
    Maybe.map (\t -> Wire.formatIrcLine "VERIFY" [ t ]) (wireToken token)


{-| `VERIFY <account> <code>` — the email-verification leg of the guest
claim flow (mirrors `verifyAccount(account, code)`; distinct from the
single-token `verifyAccount` proof helper above, which stays untouched).
-}
verifyCode : String -> String -> Maybe String
verifyCode account code =
    build "VERIFY" [ wireToken account, wireToken code ]


identify : String -> String -> Maybe String
identify account password =
    build "IDENTIFY" [ wireToken account, wireToken password ]


{-| `KEYTRANS STATUS` — fetch the credential transparency root
(mirrors `keyTransparencyStatus`; infallible).
-}
keyTransparencyStatus : String
keyTransparencyStatus =
    Wire.formatIrcLine "KEYTRANS" [ "STATUS" ]


{-| `KEYTRANS PROOF <position>` — fetch a credential inclusion proof
(mirrors `keyTransparencyProof`; the caller owns the non-negative
gate).
-}
keyTransparencyProof : Int -> Maybe String
keyTransparencyProof position =
    if position < 0 then
        Nothing

    else
        Just (Wire.formatIrcLine "KEYTRANS" [ "PROOF", String.fromInt position ])


{-| `RECOVERYCODES STATUS` — how many single-use codes remain
(mirrors `recoveryCodesStatus`; infallible).
-}
recoveryCodesStatus : String
recoveryCodesStatus =
    Wire.formatIrcLine "RECOVERYCODES" [ "STATUS" ]


{-| `RECOVERYCODES GENERATE [password]` — mint a fresh code batch
(mirrors `recoveryCodesGenerate`; an empty password sends bare,
a present one is wire-gated fail-closed).
-}
recoveryCodesGenerate : Maybe String -> Maybe String
recoveryCodesGenerate password =
    case Maybe.map String.trim password of
        Just trimmed ->
            if String.isEmpty trimmed then
                Just (Wire.formatIrcLine "RECOVERYCODES" [ "GENERATE" ])

            else
                Maybe.map
                    (\safe -> Wire.formatIrcLine "RECOVERYCODES" [ "GENERATE", safe ])
                    (wireToken trimmed)

        Nothing ->
            Just (Wire.formatIrcLine "RECOVERYCODES" [ "GENERATE" ])


{-| `RECOVERYCODES CLEAR [password]` — burn every code (mirrors
`recoveryCodesClear`; same password shape as generate).
-}
recoveryCodesClear : Maybe String -> Maybe String
recoveryCodesClear password =
    case Maybe.map String.trim password of
        Just trimmed ->
            if String.isEmpty trimmed then
                Just (Wire.formatIrcLine "RECOVERYCODES" [ "CLEAR" ])

            else
                Maybe.map
                    (\safe -> Wire.formatIrcLine "RECOVERYCODES" [ "CLEAR", safe ])
                    (wireToken trimmed)

        Nothing ->
            Just (Wire.formatIrcLine "RECOVERYCODES" [ "CLEAR" ])


{-| `RECOVERYCODES LOGIN <account> <code>` — sign in with a
single-use code (mirrors `recoveryCodesLogin`; the caller owns the
normalize + min-length gate).
-}
recoveryCodesLogin : String -> String -> Maybe String
recoveryCodesLogin account code =
    build "RECOVERYCODES" [ Just "LOGIN", wireToken account, wireToken code ]


{-| `TOTP ENROLL` — start a 2FA enrollment (mirrors `totpEnroll`;
infallible: both params are literals).
-}
totpEnroll : String
totpEnroll =
    Wire.formatIrcLine "TOTP" [ "ENROLL" ]


{-| `TOTP CONFIRM <code>` — confirm an enrollment with the 6-digit
code (mirrors `totpConfirm`; the caller owns the digit-shape guard).
-}
totpConfirm : String -> Maybe String
totpConfirm code =
    build "TOTP" [ Just "CONFIRM", wireToken code ]


{-| `TOTP DISABLE` — turn 2FA off (mirrors `totpDisable`).
-}
totpDisable : String
totpDisable =
    Wire.formatIrcLine "TOTP" [ "DISABLE" ]


{-| `TOTP STATUS` — ask for the current 2FA state (mirrors
`totpStatus`; never sets busy, like the oracle).
-}
totpStatus : String
totpStatus =
    Wire.formatIrcLine "TOTP" [ "STATUS" ]


logout : String
logout =
    Wire.formatIrcLine "LOGOUT" []


dropAccount : String -> String -> Maybe String
dropAccount account password =
    build "DROP" [ wireToken account, wireToken password ]


accountInfo : Maybe String -> Maybe String
accountInfo account =
    case account of
        Nothing ->
            Just (Wire.formatIrcLine "ACCOUNTINFO" [])

        Just name ->
            Maybe.map (\n -> Wire.formatIrcLine "ACCOUNTINFO" [ n ]) (wireToken name)


accountSet : String -> String -> String -> String -> Maybe String
accountSet account password field value =
    build "ACCOUNTSET" [ wireToken account, wireToken password, wireToken field, wireText value ]


saslInfo : String
saslInfo =
    Wire.formatIrcLine "SASLINFO" []


ghost : String -> String -> Maybe String
ghost nick password =
    build "GHOST" [ wireToken nick, wireToken password ]


recover : String -> Maybe String
recover nick =
    Maybe.map (\n -> Wire.formatIrcLine "RECOVER" [ n ]) (wireToken nick)


releaseNick : String -> Maybe String
releaseNick nick =
    Maybe.map (\n -> Wire.formatIrcLine "RELEASE" [ n ]) (wireToken nick)


channelService : String -> List String -> Maybe String
channelService sub args =
    buildSub "CHANNEL" sub (List.map wireToken args)


autojoin : String -> List String -> Maybe String
autojoin sub args =
    buildSub "AUTOJOIN" sub (List.map wireToken args)


groupCommand : List String -> Maybe String
groupCommand args =
    build "GROUP" (List.map wireToken args)


seen : String -> Maybe String
seen account =
    Maybe.map (\a -> Wire.formatIrcLine "SEEN" [ a ]) (wireToken account)


{-| `MEMO` only — never a historical alias. SEND takes trailing text;
IGNORE takes ADD/DEL/LIST plus an account.
-}
memo : String -> List String -> Maybe String
memo sub args =
    case String.toUpper sub of
        "SEND" ->
            case args of
                [ account, message ] ->
                    case ( wireToken account, wireText message ) of
                        ( Just a, Just m ) ->
                            Just (Wire.formatIrcLine "MEMO" [ "SEND", a, m ])

                        _ ->
                            Nothing

                _ ->
                    Nothing

        "IGNORE" ->
            case args of
                [ op, account ] ->
                    case String.toUpper op of
                        "ADD" ->
                            buildSub "MEMO" "IGNORE" [ Just "ADD", wireToken account ]

                        "DEL" ->
                            buildSub "MEMO" "IGNORE" [ Just "DEL", wireToken account ]

                        "LIST" ->
                            buildSub "MEMO" "IGNORE" [ Just "LIST", wireToken account ]

                        _ ->
                            Nothing

                _ ->
                    Nothing

        "LIST" ->
            if List.isEmpty args then
                Just (Wire.formatIrcLine "MEMO" [ "LIST" ])

            else
                Nothing

        "CLEAR" ->
            if List.isEmpty args then
                Just (Wire.formatIrcLine "MEMO" [ "CLEAR" ])

            else
                Nothing

        "FORWARD" ->
            case args of
                [ account ] ->
                    Maybe.map (\a -> Wire.formatIrcLine "MEMO" [ "FORWARD", a ]) (wireToken account)

                _ ->
                    Nothing

        "OFF" ->
            if List.isEmpty args then
                Just (Wire.formatIrcLine "MEMO" [ "OFF" ])

            else
                Nothing

        _ ->
            Nothing


vhost : String -> List String -> Maybe String
vhost sub args =
    buildSub "VHOST" sub (List.map wireToken args)


{-| `VHOST LIST` — refresh the persona roster (mirrors `vhostList`).
-}
vhostList : String
vhostList =
    Wire.formatIrcLine "VHOST" [ "LIST" ]


{-| `VHOST USE <persona>` (mirrors `vhostUse`: the persona slot is
refused locally when the wire gate rejects it, like `usePersona`).
-}
vhostUse : String -> Maybe String
vhostUse name =
    Maybe.map (\n -> Wire.formatIrcLine "VHOST" [ "USE", n ]) (wireToken name)


{-| `VHOST CLAIM <host>` (mirrors `vhostClaim`: the host slot is
refused locally when the wire gate rejects it, like `claimHost`).
-}
vhostClaim : String -> Maybe String
vhostClaim host =
    Maybe.map (\h -> Wire.formatIrcLine "VHOST" [ "CLAIM", h ]) (wireToken host)


{-| `VHOST OFF` — take off the active vhost (mirrors `vhostOff`).
-}
vhostOff : String
vhostOff =
    Wire.formatIrcLine "VHOST" [ "OFF" ]


{-| `MONITOR + <nick>` (mirrors `monitorAdd`: the nick slot is
refused locally when the wire gate rejects it — the callers only
pass contact-normalized nicks, so this is defense in depth).
-}
monitorAdd : String -> Maybe String
monitorAdd nick =
    Maybe.map (\n -> Wire.formatIrcLine "MONITOR" [ "+", n ]) (wireToken nick)


{-| `MONITOR - <nick>` (mirrors the `-` leg of
`_removeMonitorContactIfUnused`).
-}
monitorRemove : String -> Maybe String
monitorRemove nick =
    Maybe.map (\n -> Wire.formatIrcLine "MONITOR" [ "-", n ]) (wireToken nick)


{-| `MONITOR C` — clear the connection's subscriptions before a
full resubscribe (mirrors the `clearRemote` leg of
`_replaceOwnedMonitorContacts`).
-}
monitorClear : String
monitorClear =
    Wire.formatIrcLine "MONITOR" [ "C" ]


certAdd : String -> Maybe String
certAdd fingerprint =
    Maybe.map (\f -> Wire.formatIrcLine "CERTADD" [ f ]) (wireToken fingerprint)


certList : String
certList =
    Wire.formatIrcLine "CERTLIST" []


certDel : String -> Maybe String
certDel fingerprint =
    Maybe.map (\f -> Wire.formatIrcLine "CERTDEL" [ f ]) (wireToken fingerprint)


{-| `E2EEKEY STATUS` — ask for the device-key registry state
(mirrors `e2eeKeyStatus`; infallible).
-}
e2eeKeyStatus : String
e2eeKeyStatus =
    Wire.formatIrcLine "E2EEKEY" [ "STATUS" ]


{-| `E2EEKEY LIST [account]` — list registered device keys
(mirrors `e2eeKeyList`; a blank account sends bare).
-}
e2eeKeyList : Maybe String -> String
e2eeKeyList account =
    case Maybe.map String.trim account of
        Just trimmed ->
            if String.isEmpty trimmed then
                Wire.formatIrcLine "E2EEKEY" [ "LIST" ]

            else
                case wireToken trimmed of
                    Just safe ->
                        Wire.formatIrcLine "E2EEKEY" [ "LIST", safe ]

                    Nothing ->
                        Wire.formatIrcLine "E2EEKEY" [ "LIST" ]

        Nothing ->
            Wire.formatIrcLine "E2EEKEY" [ "LIST" ]


{-| Device-id shape, mirroring `DEVICE_ID_RE` (`/^[A-Za-z0-9_.-]{1,32}$/`).
-}
validE2eeDeviceId : String -> Bool
validE2eeDeviceId value =
    let
        ok c =
            Char.isAlphaNum c || c == '_' || c == '.' || c == '-'
    in
    not (String.isEmpty value)
        && String.length value <= 32
        && String.all ok value


{-| Algorithm shape, mirroring `ALGORITHM_RE` (`/^[A-Za-z0-9_-]{1,32}$/`).
-}
validE2eeAlgorithm : String -> Bool
validE2eeAlgorithm value =
    let
        ok c =
            Char.isAlphaNum c || c == '_' || c == '-'
    in
    not (String.isEmpty value)
        && String.length value <= 32
        && String.all ok value


{-| Public-key shape, mirroring `PUBLIC_KEY_RE`
(`/^[A-Za-z0-9_\-+/=.: ]{1,180}$/`).
-}
validE2eePublicKey : String -> Bool
validE2eePublicKey value =
    let
        ok c =
            Char.isAlphaNum c
                || c == '_'
                || c == '-'
                || c == '+'
                || c == '/'
                || c == '='
                || c == '.'
                || c == ':'
                || c == ' '
    in
    not (String.isEmpty value)
        && String.length value <= 180
        && String.all ok value


{-| `E2EEKEY ADD <id> <algorithm> <key>` (mirrors `e2eeKeyAdd`:
every leg shape-checked locally, fail-closed to `Nothing`).
-}
e2eeKeyAdd : String -> String -> String -> Maybe String
e2eeKeyAdd deviceId algorithm publicKey =
    let
        id =
            String.trim deviceId

        alg =
            String.trim algorithm

        key =
            String.trim publicKey
    in
    if not (validE2eeDeviceId id) then
        Nothing

    else if not (validE2eeAlgorithm alg) then
        Nothing

    else if not (validE2eePublicKey key) then
        Nothing

    else
        Just (Wire.formatIrcLine "E2EEKEY" [ "ADD", id, alg, key ])


{-| `E2EEKEY DEL <id>` (mirrors `e2eeKeyDelete`: blank ids refused
locally).
-}
e2eeKeyDel : String -> Maybe String
e2eeKeyDel deviceId =
    let
        id =
            String.trim deviceId
    in
    if String.isEmpty id then
        Nothing

    else
        Maybe.map (\safe -> Wire.formatIrcLine "E2EEKEY" [ "DEL", safe ]) (wireToken id)


whois : String -> Maybe String
whois nick =
    Maybe.map (\n -> Wire.formatIrcLine "WHOIS" [ n, n ]) (normalizeNick nick)


who : String -> Maybe String
who mask =
    Maybe.map (\m -> Wire.formatIrcLine "WHO" [ m ]) (wireText mask)


{-| WHOX field letters the server accepts (`whox.zig` Field enum).
-}
whoxFields : String
whoxFields =
    "tcuihsnfdlaro"


maxWhoxSelectorFields : Int
maxWhoxSelectorFields =
    16


maxWhoxTokenBytes : Int
maxWhoxTokenBytes =
    32


{-| WHO with a WHOX selector (`WHO <target> %fields[,token]`). The
selector mirrors the server's `whox.parse`: `%` + 1–16 unique field
letters, then an optional single `,token` of 1–32 bytes with no
space/tab/CR/LF/NUL. RPL_WHOSPCRPL (354) rows follow the requested
field order, so the selector is the only parse key — validate it
here, fail closed.
-}
whox : String -> String -> Maybe String
whox target selector =
    case ( wireText target, validWhoxSelector selector ) of
        ( Just t, True ) ->
            Just (Wire.formatIrcLine "WHO" [ t, selector ])

        _ ->
            Nothing


validWhoxSelector : String -> Bool
validWhoxSelector selector =
    case String.split "," selector of
        [ fields ] ->
            validWhoxFields fields

        [ fields, token ] ->
            validWhoxFields fields && validWhoxToken token

        _ ->
            False


validWhoxFields : String -> Bool
validWhoxFields fields =
    case String.uncons fields of
        Just ( '%', rest ) ->
            let
                letters =
                    String.toList rest
            in
            not (List.isEmpty letters)
                && List.length letters <= maxWhoxSelectorFields
                && List.all (\c -> String.contains (String.fromChar c) whoxFields) letters
                && List.length letters == Set.size (Set.fromList letters)

        _ ->
            False


validWhoxToken : String -> Bool
validWhoxToken token =
    not (String.isEmpty token)
        && String.length token <= maxWhoxTokenBytes
        && not (String.any (\c -> c == ' ' || c == '\t' || c == '\r' || c == '\n' || Char.toCode c == 0) token)


{-| `HELP [topic]` — server answers 704/705/706 (or 524 when the topic
is unknown).
-}
helpTopic : Maybe String -> Maybe String
helpTopic topic =
    case topic of
        Nothing ->
            Just (Wire.formatIrcLine "HELP" [])

        Just t ->
            Maybe.map (\x -> Wire.formatIrcLine "HELP" [ x ]) (wireToken t)


{-| `HELPOP [topic]` — same reply shape as HELP.
-}
helpOp : Maybe String -> Maybe String
helpOp topic =
    case topic of
        Nothing ->
            Just (Wire.formatIrcLine "HELPOP" [])

        Just t ->
            Maybe.map (\x -> Wire.formatIrcLine "HELPOP" [ x ]) (wireToken t)


{-| `WELCOME` — show the oper-managed onboarding pack (per-line
`NOTICE` pack plus an end-of-pack notice).
-}
welcomeShow : String
welcomeShow =
    Wire.formatIrcLine "WELCOME" []


{-| `WELCOME CLEAR` — oper-only pack reset.
-}
welcomeClear : String
welcomeClear =
    Wire.formatIrcLine "WELCOME" [ "CLEAR" ]


{-| `WELCOME ADD :<line>` — oper-only pack append.
-}
welcomeAdd : String -> Maybe String
welcomeAdd line =
    Maybe.map (\l -> Wire.formatIrcLine "WELCOME" [ "ADD", l ]) (wireText line)


whowas : String -> Maybe String
whowas nick =
    Maybe.map (\n -> Wire.formatIrcLine "WHOWAS" [ n ]) (normalizeNick nick)


listChannels : Maybe String -> Maybe String
listChannels mask =
    case mask of
        Nothing ->
            Just (Wire.formatIrcLine "LIST" [])

        Just m ->
            Maybe.map (\x -> Wire.formatIrcLine "LIST" [ x ]) (wireToken m)


ison : List String -> Maybe String
ison nicks =
    if List.isEmpty nicks then
        Nothing

    else
        build "ISON" (List.map normalizeNick nicks)


userhost : List String -> Maybe String
userhost nicks =
    if List.isEmpty nicks then
        Nothing

    else if List.length nicks > 5 then
        Nothing

    else
        build "USERHOST" (List.map normalizeNick nicks)


away : Maybe String -> Maybe String
away message =
    case message of
        Nothing ->
            Just (Wire.formatIrcLine "AWAY" [])

        Just text ->
            Maybe.map (\t -> Wire.formatIrcLine "AWAY" [ t ]) (wireText text)


setName : String -> Maybe String
setName realname =
    Maybe.map (\r -> Wire.formatIrcLine "SETNAME" [ r ]) (wireText realname)


monitor : String -> List String -> Maybe String
monitor sub args =
    case String.toUpper sub of
        "L" ->
            guardEmpty args (Wire.formatIrcLine "MONITOR" [ "L" ])

        "S" ->
            guardEmpty args (Wire.formatIrcLine "MONITOR" [ "S" ])

        "C" ->
            guardEmpty args (Wire.formatIrcLine "MONITOR" [ "C" ])

        _ ->
            if List.isEmpty args then
                Nothing

            else
                buildSub "MONITOR" sub (List.map normalizeNick args)


guardEmpty : List String -> String -> Maybe String
guardEmpty args line =
    if List.isEmpty args then
        Just line

    else
        Nothing


silenceEntry : String -> String -> Maybe String
silenceEntry op mask =
    case String.toUpper op of
        "+" ->
            build "SILENCE" [ Just "+", wireText mask ]

        "-" ->
            build "SILENCE" [ Just "-", wireText mask ]

        _ ->
            Nothing


acceptEntry : String -> String -> Maybe String
acceptEntry op nick =
    case String.toUpper op of
        "+" ->
            build "ACCEPT" [ Just "+", normalizeNick nick ]

        "-" ->
            build "ACCEPT" [ Just "-", normalizeNick nick ]

        _ ->
            Nothing



-- ── Offline-send admission ───────────────────────────────────────────


{-| Pure terminal of `sendMessage`'s offline branch:

  - online → attempt the live send;
  - offline slash commands → attempt live (never queued: replaying a
    stale command into a fresh session is surprising, a message isn't);
  - offline into a required-E2EE room → refuse (sealing needs the live
    group runtime; queuing plaintext would break "outbox only ever
    sees ciphertext");
  - offline E2EE-designated DM → refuse (same invariant);
  - offline with no vault owner → refuse;
  - otherwise → queue the plaintext, fired on reconnect via flush.

-}
type OfflineSendDecision
    = AttemptLiveSend
    | QueuePlaintext
    | RefuseEncryptedRoom
    | RefuseEncryptedDm
    | RefuseNoOwner


decideOfflineSend :
    { connected : Bool
    , text : String
    , target : String
    , chantypes : String
    , requiredE2EE : Bool
    , dmE2EEDesignated : Bool
    , hasOwner : Bool
    }
    -> OfflineSendDecision
decideOfflineSend input =
    if input.connected then
        AttemptLiveSend

    else if String.startsWith "/" input.text then
        AttemptLiveSend

    else if input.requiredE2EE then
        RefuseEncryptedRoom

    else if isDmTarget input.chantypes input.target && input.dmE2EEDesignated then
        RefuseEncryptedDm

    else if not input.hasOwner then
        RefuseNoOwner

    else
        QueuePlaintext


isDmTarget : String -> String -> Bool
isDmTarget chantypes target =
    case String.uncons target of
        Just ( first, _ ) ->
            not (String.contains (String.fromChar first) chantypes)

        Nothing ->
            False


maxUserProfiles : Int
maxUserProfiles =
    256


{-| Persistent rich user profile (Elm port of the oracle
`RichUserProfile`: the WHOIS dual-write target. `ocean.*` METADATA
names stay frozen wire format — the METADATA→profile mapping lands
with the metadata slice; only the WHOIS/SETNAME fields patch here).
-}
type alias UserProfile =
    { nick : String
    , account : Maybe String
    , realname : Maybe String
    , bio : Maybe String
    , bannerColor : Maybe String
    , bannerUrl : Maybe String
    , pronouns : Maybe String
    , displayName : Maybe String
    , accentColor : Maybe String
    , links : List String
    , joinedAt : Maybe Int
    , ircOperator : Bool
    , bot : Bool
    , channels : List String
    , away : Bool
    , awayMessage : Maybe String
    , server : Maybe String
    , serverInfo : Maybe String
    , idleSeconds : Maybe Int
    , signonTime : Maybe Int
    }


blankUserProfile : String -> UserProfile
blankUserProfile nick =
    { nick = nick
    , account = Nothing
    , realname = Nothing
    , bio = Nothing
    , bannerColor = Nothing
    , bannerUrl = Nothing
    , pronouns = Nothing
    , displayName = Nothing
    , accentColor = Nothing
    , links = []
    , joinedAt = Nothing
    , ircOperator = False
    , bot = False
    , channels = []
    , away = False
    , awayMessage = Nothing
    , server = Nothing
    , serverInfo = Nothing
    , idleSeconds = Nothing
    , signonTime = Nothing
    }


{-| A partial profile write (mirroring `Partial<RichUserProfile>`).
Text fields are tri-state — `Just` carries the key (an inner
`Nothing` clears, mirroring the oracle spread overwriting with
`undefined`) while outer `Nothing` leaves the stored value alone.
-}
type alias UserProfilePatch =
    { account : Maybe (Maybe String)
    , realname : Maybe (Maybe String)
    , server : Maybe (Maybe String)
    , serverInfo : Maybe (Maybe String)
    , awayMessage : Maybe (Maybe String)
    , displayName : Maybe (Maybe String)
    , pronouns : Maybe (Maybe String)
    , bio : Maybe (Maybe String)
    , accentColor : Maybe (Maybe String)
    , bannerUrl : Maybe (Maybe String)
    , links : Maybe (List String)
    , away : Maybe Bool
    , ircOperator : Maybe Bool
    , bot : Maybe Bool
    , channels : Maybe (List String)
    , idleSeconds : Maybe Int
    , signonTime : Maybe Int
    }


emptyUserProfilePatch : UserProfilePatch
emptyUserProfilePatch =
    { account = Nothing
    , realname = Nothing
    , server = Nothing
    , serverInfo = Nothing
    , awayMessage = Nothing
    , displayName = Nothing
    , pronouns = Nothing
    , bio = Nothing
    , accentColor = Nothing
    , bannerUrl = Nothing
    , links = Nothing
    , away = Nothing
    , ircOperator = Nothing
    , bot = Nothing
    , channels = Nothing
    , idleSeconds = Nothing
    , signonTime = Nothing
    }


applyUserProfilePatch : UserProfile -> UserProfilePatch -> UserProfile
applyUserProfilePatch current patch =
    { current
        | account = Maybe.withDefault current.account patch.account
        , realname = Maybe.withDefault current.realname patch.realname
        , server = Maybe.withDefault current.server patch.server
        , serverInfo = Maybe.withDefault current.serverInfo patch.serverInfo
        , awayMessage = Maybe.withDefault current.awayMessage patch.awayMessage
        , displayName = Maybe.withDefault current.displayName patch.displayName
        , pronouns = Maybe.withDefault current.pronouns patch.pronouns
        , bio = Maybe.withDefault current.bio patch.bio
        , accentColor = Maybe.withDefault current.accentColor patch.accentColor
        , bannerUrl = Maybe.withDefault current.bannerUrl patch.bannerUrl
        , links = Maybe.withDefault current.links patch.links
        , away = Maybe.withDefault current.away patch.away
        , ircOperator = Maybe.withDefault current.ircOperator patch.ircOperator
        , bot = Maybe.withDefault current.bot patch.bot
        , channels = Maybe.withDefault current.channels patch.channels
        , idleSeconds = orKeep patch.idleSeconds current.idleSeconds
        , signonTime = orKeep patch.signonTime current.signonTime
    }


{-| Single-Maybe patch over a Maybe field: a present patch value
wins (wrapped), an absent patch keeps the stored value. -}
orKeep : Maybe a -> Maybe a -> Maybe a
orKeep patch current =
    case patch of
        Just v ->
            Just v

        Nothing ->
            current


{-| Profile-key nick validation (mirroring `_normalizeMetadataTarget`
with the 256-char sender bound: single token, no controls, no
colon-lead, no comma, and never a prototype-pollution key — Elm
`Dict` cannot be polluted, but the refusal keeps key coverage 1:1).
-}
normalizeProfileNick : String -> Maybe String
normalizeProfileNick value =
    case normalizeNick value of
        Nothing ->
            Nothing

        Just safe ->
            if List.member (String.toLower safe) [ "__proto__", "prototype", "constructor" ] then
                Nothing

            else
                Just safe


{-| Merge a patch into the profile map (mirroring `setUserProfile`:
invalid nicks drop, the 256-target budget refuses only new keys, and
patches merge over the stored profile or a fresh `{ nick }` base
that keeps first-seen casing).
-}
setUserProfileOn : Dict String UserProfile -> String -> UserProfilePatch -> Dict String UserProfile
setUserProfileOn profiles nick patch =
    case normalizeProfileNick nick of
        Nothing ->
            profiles

        Just safe ->
            let
                key =
                    String.toLower safe
            in
            if not (Dict.member key profiles) && Dict.size profiles >= maxUserProfiles then
                profiles

            else
                let
                    base =
                        Maybe.withDefault (blankUserProfile safe) (Dict.get key profiles)
                in
                Dict.insert key (applyUserProfilePatch base patch) profiles


{-| Look a profile up by nick (mirroring `getUserProfile`). -}
getUserProfileFrom : Dict String UserProfile -> String -> Maybe UserProfile
getUserProfileFrom profiles nick =
    Dict.get (String.toLower nick) profiles


{-| Dual-write the WHOIS numerics into the profile map (mirroring the
`setUserProfile` call inside each numeric arm: 301 away, 311
nick + realname, 312 server, 313 oper, 317 idle, 319 merged
channels, 330 account, 335 bot). Gated on the active sheet nick like
the sheet itself, so unsolicited numerics plant nothing; 319 takes
the already-merged sheet channels. All other commands pass through.
-}
foldWhoisProfile : Dict String UserProfile -> WhoisCache -> String -> Wire.IrcMessage -> Dict String UserProfile
foldWhoisProfile profiles cache activeNick message =
    case activeTarget activeNick (paramAt 1 message.params) of
        Nothing ->
            profiles

        Just safe ->
            let
                patchFor =
                    case message.command of
                        "301" ->
                            Just
                                { emptyUserProfilePatch
                                    | away = Just True
                                    , awayMessage = Just (Maybe.map String.trim (boundedText (paramAt 2 message.params)))
                                }

                        "311" ->
                            Just
                                { emptyUserProfilePatch
                                    | realname = Just (boundedText (paramAt 5 message.params))
                                }

                        "312" ->
                            Just
                                { emptyUserProfilePatch
                                    | server = Just (boundedText (paramAt 2 message.params))
                                    , serverInfo = Just (boundedText (paramAt 3 message.params))
                                }

                        "313" ->
                            Just { emptyUserProfilePatch | ircOperator = Just True }

                        "317" ->
                            Just
                                { emptyUserProfilePatch
                                    | idleSeconds = Just (boundedNumber (paramAt 2 message.params))
                                    , signonTime = Just (boundedNumber (paramAt 3 message.params))
                                }

                        "319" ->
                            Just { emptyUserProfilePatch | channels = Just (sheetChannels cache safe) }

                        "330" ->
                            Just
                                { emptyUserProfilePatch
                                    | account = Just (boundedText (paramAt 2 message.params))
                                }

                        "335" ->
                            Just { emptyUserProfilePatch | bot = Just True }

                        _ ->
                            Nothing
            in
            case patchFor of
                Nothing ->
                    profiles

                Just patch ->
                    setUserProfileOn profiles safe patch


{-| Merged sheet channels for the 319 profile write (the sheet fold
already unioned the fragments, mirroring the oracle merge base).
-}
sheetChannels : WhoisCache -> String -> List String
sheetChannels cache nick =
    case Dict.get (String.toLower nick) cache.entries of
        Just entry ->
            entry.channels

        Nothing ->
            []

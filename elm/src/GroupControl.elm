module GroupControl exposing
    ( ControlKind(..)
    , ControlRecord
    , Delivery
    , E2eGroupFail(..)
    , GroupLockReason(..)
    , PayloadParts
    , RoomProjection
    , RoomStatus(..)
    , Routing
    , buildGroupControlLine
    , buildGroupControlTranscript
    , deliveryCommand
    , deliveryKindFromCommand
    , e2eGroupFailText
    , groupControlCommand
    , InstallInfo
    , installInfo
    , kindToString
    , ControlPair
    , Pairable
    , PairBuffer
    , PairEvent(..)
    , PairRecord
    , blankPairBuffer
    , bufferDelivery
    , getPair
    , kindFromString
    , maxHalfPairs
    , pairBaseKey
    , pairHasPayload
    , removePair
    , welcomeTargetKey
    , maxGroupControlAccountChars
    , maxGroupControlBodyBytes
    , maxGroupControlChannelBytes
    , maxGroupControlDeviceChars
    , maxGroupControlPayloadChars
    , maxGroupControlWireB64
    , normalizeControlChannel
    , normalizeGroupControlRouting
    , packGroupControlPayload
    , parseDeliveryLine
    , parseDeliveryMessage
    , parseE2eGroupFail
    , parseGroupControlMessage
    , parseGroupControlPayload
    , payloadMagic
    , payloadVersion
    , payloadLegacyVersion
    , payloadDomain
    , validControlEpoch
    )

{-| Bounded wire codec for opaque room-E2EE control records — Elm port of
the pure surface of `src/lib/e2ee/groupControl.ts` (routing layer) and
`src/lib/e2ee/groupControlPayload.ts` (OGC1 signed-envelope shape,
routing normalization, Ed25519 transcript).

The payload bytes are treated as uninterpreted here; cryptographic
sign/verify and AES-GCM seal/open live behind ports (WebCrypto). This
module enforces the client/server routing contract from
`onyx-client-contract.v2.json` (`e2ee_group.control_command`,
`command_vectors`, `message_policy_vectors`): limits, canonical
base64url, OGC1 magic/version/kind/size checks, and the exact transcript
byte layout that signatures bind.

Fail-closed throughout: every negative path is `Nothing`/`null`
equivalents, never a partial record.

-}

import Base64Url
import Bitwise
import Dict exposing (Dict)
import Wire exposing (IrcMessage)


groupControlCommand : String
groupControlCommand =
    "E2EEGROUP"


{-| Daemon limit for the trailing base64url parameter (chars). -}
maxGroupControlPayloadChars : Int
maxGroupControlPayloadChars =
    4096


maxGroupControlWireB64 : Int
maxGroupControlWireB64 =
    4096


maxGroupControlAccountChars : Int
maxGroupControlAccountChars =
    64


maxGroupControlDeviceChars : Int
maxGroupControlDeviceChars =
    32


maxGroupControlChannelBytes : Int
maxGroupControlChannelBytes =
    128


{-| OGC1 `OGC1` magic. -}
payloadMagic : String
payloadMagic =
    "OGC1"


{-| Current versioned payload format. -}
payloadVersion : Int
payloadVersion =
    2


{-| Legacy payload version: parse for diagnostics, never trust or verify. -}
payloadLegacyVersion : Int
payloadLegacyVersion =
    1


{-| Domain separation label for the Ed25519 transcript (current v2). -}
payloadDomain : String
payloadDomain =
    "ONYX-GROUP-CONTROL-v2"


{-| Hard cap on the OGC1 body field (bytes). -}
maxGroupControlBodyBytes : Int
maxGroupControlBodyBytes =
    2048


{-| Fixed header + trailer size excluding the variable body:
magic(4) + version(1) + kind(1) + epoch(4) + body_len(2) + pub(32) + sig(64).
-}
fixedEnvelopeBytes : Int
fixedEnvelopeBytes =
    108


type ControlKind
    = KeyPackage
    | Welcome
    | Commit


type alias ControlRecord =
    { channel : String
    , kind : ControlKind
    , fromDevice : String
    , toAccount : Maybe String
    , toDevice : Maybe String
    , payload : String
    }


type alias Routing =
    { channel : String
    , kind : ControlKind
    , fromDevice : String
    , fromAccount : String
    , toAccount : Maybe String
    , toDevice : Maybe String
    }


type alias PayloadParts =
    { version : Int
    , kind : ControlKind
    , epoch : Int
    , body : List Int
    , signerPub : List Int
    , signature : List Int
    , diagnosticOnly : Bool
    }



-- byte helpers


getAt : Int -> List Int -> Maybe Int
getAt idx bytes =
    List.head (List.drop idx bytes)


sliceBytes : Int -> Int -> List Int -> List Int
sliceBytes from to bytes =
    List.take (to - from) (List.drop from bytes)


readU16be : List Int -> Int -> Int
readU16be bytes offset =
    let
        hi =
            Maybe.withDefault 0 (getAt offset bytes)

        lo =
            Maybe.withDefault 0 (getAt (offset + 1) bytes)
    in
    Bitwise.or (Bitwise.shiftLeftBy 8 hi) lo


readU32be : List Int -> Int -> Int
readU32be bytes offset =
    let
        b0 =
            Maybe.withDefault 0 (getAt offset bytes)

        b1 =
            Maybe.withDefault 0 (getAt (offset + 1) bytes)

        b2 =
            Maybe.withDefault 0 (getAt (offset + 2) bytes)

        b3 =
            Maybe.withDefault 0 (getAt (offset + 3) bytes)
    in
    Bitwise.or
        (Bitwise.shiftLeftBy 24 b0)
        (Bitwise.or
            (Bitwise.shiftLeftBy 16 b1)
            (Bitwise.or (Bitwise.shiftLeftBy 8 b2) b3)
        )


writeU32be : Int -> List Int
writeU32be value =
    [ Bitwise.and 0xFF (Bitwise.shiftRightBy 24 value)
    , Bitwise.and 0xFF (Bitwise.shiftRightBy 16 value)
    , Bitwise.and 0xFF (Bitwise.shiftRightBy 8 value)
    , Bitwise.and 0xFF value
    ]


writeU16be : Int -> List Int
writeU16be value =
    [ Bitwise.and 0xFF (Bitwise.shiftRightBy 8 value)
    , Bitwise.and 0xFF value
    ]



-- validators


isDeviceChar : Char -> Bool
isDeviceChar c =
    let
        code =
            Char.toCode c
    in
    (code >= 0x41 && code <= 0x5A)
        || (code >= 0x61 && code <= 0x7A)
        || (code >= 0x30 && code <= 0x39)
        || code == 0x5F
        || code == 0x2D
        || code == 0x2E


isAccountChar : Char -> Bool
isAccountChar c =
    let
        code =
            Char.toCode c
    in
    (code >= 0x41 && code <= 0x5A)
        || (code >= 0x61 && code <= 0x7A)
        || (code >= 0x30 && code <= 0x39)
        || code == 0x5F
        || code == 0x2E
        || code == 0x40
        || code == 0x2D


isForbiddenChannelInner : Char -> Bool
isForbiddenChannelInner c =
    let
        code =
            Char.toCode c
    in
    code <= 0x20 || code == 0x2C || code == 0x3A || code == 0x7F


{-| Routing-layer channel shape: leading `#`/`&`, no separators.
Case is NOT folded here (the routing codec preserves it); the OGC1
transcript layer normalizes separately.
-}
validChannel : String -> Bool
validChannel value =
    if String.length value < 2 || Base64Url.utf8ByteLength value > maxGroupControlChannelBytes then
        False

    else
        case String.uncons value of
            Just ( first, _ ) ->
                if first /= '#' && first /= '&' then
                    False

                else
                    not (List.any isForbiddenChannelInner (String.toList (String.dropLeft 1 value)))

            Nothing ->
                False


validDevice : String -> Bool
validDevice value =
    not (String.isEmpty value)
        && String.length value <= maxGroupControlDeviceChars
        && List.all isDeviceChar (String.toList value)


validAccount : String -> Bool
validAccount value =
    not (String.isEmpty value)
        && String.length value <= maxGroupControlAccountChars
        && List.all isAccountChar (String.toList value)


validPayload : String -> Bool
validPayload value =
    if String.isEmpty value || String.length value > maxGroupControlPayloadChars then
        False

    else
        case Base64Url.decode value of
            Just raw ->
                Base64Url.encode raw == value

            Nothing ->
                False


{-| Epoch range. Divergence note (see COVERAGE.md): Elm `Int` is 32-bit
signed, so wire values `2^31..2^32-1` decode to negative `Int`s and are
rejected here; the oracle accepts them. Epochs increment from 0.
-}
validControlEpoch : Int -> Bool
validControlEpoch epoch =
    epoch >= 0


validBody : List Int -> Bool
validBody body =
    not (List.isEmpty body) && List.length body <= maxGroupControlBodyBytes



-- routing codec


kindCode : ControlKind -> Int
kindCode kind =
    case kind of
        KeyPackage ->
            1

        Welcome ->
            2

        Commit ->
            3


kindFromCode : Int -> Maybe ControlKind
kindFromCode code =
    if code == 1 then
        Just KeyPackage

    else if code == 2 then
        Just Welcome

    else if code == 3 then
        Just Commit

    else
        Nothing


kindFromString : String -> Maybe ControlKind
kindFromString text =
    case text of
        "key-package" ->
            Just KeyPackage

        "welcome" ->
            Just Welcome

        "commit" ->
            Just Commit

        _ ->
            Nothing


kindToString : ControlKind -> String
kindToString kind =
    case kind of
        KeyPackage ->
            "key-package"

        Welcome ->
            "welcome"

        Commit ->
            "commit"


validRecord : ControlRecord -> Bool
validRecord record =
    if not (validChannel record.channel) then
        False

    else if not (validDevice record.fromDevice) then
        False

    else if not (validPayload record.payload) then
        False

    else if record.kind == Welcome then
        validAccount (Maybe.withDefault "" record.toAccount)
            && validDevice (Maybe.withDefault "" record.toDevice)

    else
        record.toAccount == Nothing && record.toDevice == Nothing


{-| Build exactly one canonical IRC command line, including trailing CRLF. -}
buildGroupControlLine : ControlRecord -> Maybe String
buildGroupControlLine record =
    if not (validRecord record) then
        Nothing

    else
        let
            route =
                case record.kind of
                    Welcome ->
                        " " ++ Maybe.withDefault "" record.toAccount ++ " " ++ Maybe.withDefault "" record.toDevice

                    _ ->
                        ""
        in
        Just
            (groupControlCommand
                ++ " "
                ++ record.channel
                ++ " "
                ++ kindToString record.kind
                ++ " "
                ++ record.fromDevice
                ++ route
                ++ " :"
                ++ record.payload
                ++ "\r\n"
            )


{-| Parse an inbound E2EEGROUP record without decoding its payload. -}
parseGroupControlMessage : IrcMessage -> Maybe ControlRecord
parseGroupControlMessage message =
    if String.toUpper message.command /= groupControlCommand then
        Nothing

    else
        case kindFromString (String.toLower (Maybe.withDefault "" (getParam 1 message.params))) of
            Nothing ->
                Nothing

            Just kind ->
                let
                    expectedParams =
                        if kind == Welcome then
                            6

                        else
                            4
                in
                if List.length message.params /= expectedParams then
                    Nothing

                else
                    let
                        record =
                            { channel = Maybe.withDefault "" (getParam 0 message.params)
                            , kind = kind
                            , fromDevice = Maybe.withDefault "" (getParam 2 message.params)
                            , toAccount =
                                if kind == Welcome then
                                    getParam 3 message.params

                                else
                                    Nothing
                            , toDevice =
                                if kind == Welcome then
                                    getParam 4 message.params

                                else
                                    Nothing
                            , payload = Maybe.withDefault "" (getParam (expectedParams - 1) message.params)
                            }
                    in
                    if validRecord record then
                        Just record

                    else
                        Nothing


getParam : Int -> List String -> Maybe String
getParam idx params =
    List.head (List.drop idx params)



-- OGC1 payload layer


{-| Canonical channel for transcript binding: trim + lowercase, same
size/shape guards as the routing codec.
-}
normalizeControlChannel : String -> Maybe String
normalizeControlChannel channel =
    let
        normalized =
            String.toLower (String.trim channel)
    in
    if String.length normalized < 2 || Base64Url.utf8ByteLength normalized > maxGroupControlChannelBytes then
        Nothing

    else
        case String.uncons normalized of
            Just ( first, _ ) ->
                if first /= '#' && first /= '&' then
                    Nothing

                else if List.any isForbiddenChannelInner (String.toList (String.dropLeft 1 normalized)) then
                    Nothing

                else
                    Just normalized

            Nothing ->
                Nothing


normalizeFromAccount : String -> Maybe String
normalizeFromAccount value =
    let
        normalized =
            String.toLower (String.trim value)
    in
    if validAccount normalized then
        Just normalized

    else
        Nothing


{-| Normalize and validate routing for transcript/verify. Welcome
requires targets (passed through un-lowercased, mirroring the oracle);
non-welcome rejects targets.
-}
normalizeGroupControlRouting : Routing -> Maybe Routing
normalizeGroupControlRouting routing =
    case normalizeControlChannel routing.channel of
        Nothing ->
            Nothing

        Just channel ->
            if not (validDevice routing.fromDevice) then
                Nothing

            else
                case normalizeFromAccount routing.fromAccount of
                    Nothing ->
                        Nothing

                    Just fromAccount ->
                        if routing.kind == Welcome then
                            case ( routing.toAccount, routing.toDevice ) of
                                ( Just toAccount, Just toDevice ) ->
                                    if validAccount toAccount && validDevice toDevice then
                                        Just
                                            { channel = channel
                                            , kind = Welcome
                                            , fromAccount = fromAccount
                                            , fromDevice = routing.fromDevice
                                            , toAccount = Just toAccount
                                            , toDevice = Just toDevice
                                            }

                                    else
                                        Nothing

                                _ ->
                                    Nothing

                        else if routing.toAccount /= Nothing || routing.toDevice /= Nothing then
                            Nothing

                        else
                            Just
                                { channel = channel
                                , kind = routing.kind
                                , fromAccount = fromAccount
                                , fromDevice = routing.fromDevice
                                , toAccount = Nothing
                                , toDevice = Nothing
                                }


{-| Ed25519 transcript (pure). Fixed field order:

    domain ‖ 0x00 ‖ u8(from_account_len) ‖ from_account ‖ u8(channel_len)
    ‖ channel ‖ u8(kind_code) ‖ u8(from_device_len) ‖ from_device
    ‖ u8(to_account_len) ‖ to_account ‖ u8(to_device_len) ‖ to_device
    ‖ u8(version) ‖ u32be(epoch) ‖ u16be(body_len) ‖ body ‖ signer_pub

`signer_pub` is covered so the wire discovery field cannot be swapped
without invalidating the signature.
-}
buildGroupControlTranscript : Routing -> Int -> Int -> List Int -> List Int -> Maybe (List Int)
buildGroupControlTranscript routing version epoch body signerPub =
    case normalizeGroupControlRouting routing of
        Nothing ->
            Nothing

        Just norm ->
            if version /= payloadVersion then
                Nothing

            else if not (validControlEpoch epoch) || not (validBody body) then
                Nothing

            else if List.length signerPub /= 32 then
                Nothing

            else
                let
                    channel =
                        Base64Url.utf8Bytes norm.channel

                    fromAccount =
                        Base64Url.utf8Bytes norm.fromAccount

                    fromDevice =
                        Base64Url.utf8Bytes norm.fromDevice

                    toAccount =
                        Base64Url.utf8Bytes (Maybe.withDefault "" norm.toAccount)

                    toDevice =
                        Base64Url.utf8Bytes (Maybe.withDefault "" norm.toDevice)

                    parts =
                        [ channel, fromAccount, fromDevice, toAccount, toDevice ]
                in
                if List.any (\p -> List.length p > 255) parts then
                    Nothing

                else
                    Just
                        (Base64Url.utf8Bytes payloadDomain
                            ++ [ 0 ]
                            ++ [ List.length fromAccount ]
                            ++ fromAccount
                            ++ [ List.length channel ]
                            ++ channel
                            ++ [ kindCode norm.kind ]
                            ++ [ List.length fromDevice ]
                            ++ fromDevice
                            ++ [ List.length toAccount ]
                            ++ toAccount
                            ++ [ List.length toDevice ]
                            ++ toDevice
                            ++ [ Bitwise.and 0xFF version ]
                            ++ writeU32be epoch
                            ++ writeU16be (List.length body)
                            ++ body
                            ++ signerPub
                        )


{-| Pack fully-formed payload parts into canonical base64url.
Accepts v2 and legacy v1 shapes (v1 only ever renders locked).
-}
packGroupControlPayload : PayloadParts -> Maybe String
packGroupControlPayload parts =
    if parts.version /= payloadVersion && parts.version /= payloadLegacyVersion then
        Nothing

    else if not (validControlEpoch parts.epoch) || not (validBody parts.body) then
        Nothing

    else if List.length parts.signerPub /= 32 then
        Nothing

    else if List.length parts.signature /= 64 then
        Nothing

    else
        let
            raw =
                Base64Url.utf8Bytes payloadMagic
                    ++ [ Bitwise.and 0xFF parts.version ]
                    ++ [ kindCode parts.kind ]
                    ++ writeU32be parts.epoch
                    ++ writeU16be (List.length parts.body)
                    ++ parts.body
                    ++ parts.signerPub
                    ++ parts.signature

            wire =
                Base64Url.encode raw
        in
        if String.isEmpty wire || String.length wire > maxGroupControlWireB64 then
            Nothing

        else
            case Base64Url.decode wire of
                Just roundTrip ->
                    if Base64Url.encode roundTrip == wire then
                        Just wire

                    else
                        Nothing

                Nothing ->
                    Nothing


{-| Parse a wire base64url payload without cryptographic verification.
Rejects non-canonical base64url, bad magic, unknown version/kind, and
size violations.
-}
parseGroupControlPayload : String -> Maybe PayloadParts
parseGroupControlPayload wire =
    if String.isEmpty wire || String.length wire > maxGroupControlWireB64 then
        Nothing

    else
        case Base64Url.decode wire of
            Nothing ->
                Nothing

            Just raw ->
                if List.length raw < fixedEnvelopeBytes then
                    Nothing

                else if Base64Url.encode raw /= wire then
                    Nothing

                else if sliceBytes 0 4 raw /= Base64Url.utf8Bytes payloadMagic then
                    Nothing

                else
                    let
                        version =
                            Maybe.withDefault -1 (getAt 4 raw)
                    in
                    if version /= payloadVersion && version /= payloadLegacyVersion then
                        Nothing

                    else
                        case kindFromCode (Maybe.withDefault -1 (getAt 5 raw)) of
                            Nothing ->
                                Nothing

                            Just kind ->
                                let
                                    epoch =
                                        readU32be raw 6

                                    bodyLen =
                                        readU16be raw 10
                                in
                                if bodyLen == 0 || bodyLen > maxGroupControlBodyBytes then
                                    Nothing

                                else if List.length raw /= fixedEnvelopeBytes + bodyLen then
                                    Nothing

                                else
                                    Just
                                        { version = version
                                        , kind = kind
                                        , epoch = epoch
                                        , body = sliceBytes 12 (12 + bodyLen) raw
                                        , signerPub = sliceBytes (12 + bodyLen) (12 + bodyLen + 32) raw
                                        , signature = sliceBytes (12 + bodyLen + 32) (12 + bodyLen + 32 + 64) raw
                                        , diagnosticOnly = version == payloadLegacyVersion
                                        }



-- inbound delivery records


{-| Why a delivery renders locked: the account-bearing field is absent
(legacy shape), the payload envelope is a legacy/diagnostic version, or
the payload does not parse at all. Mirrors `lockReason` in
`groupControlInbound.ts`.
-}
type GroupLockReason
    = MissingAccount
    | LegacyOgc1
    | BadPayload


{-| Server-delivered `E2EE.KEYPACKAGE` / `E2EE.COMMIT` / `E2EE.WELCOME`
record. The payload stays opaque here; only routing metadata is exposed.
`locked` deliveries must render as placeholders — never attempt a
key install from them.
-}
type alias Delivery =
    { command : String
    , channel : String
    , kind : ControlKind
    , fromAccount : String
    , fromDevice : String
    , toAccount : Maybe String
    , toDevice : Maybe String
    , payload : String
    , sourcePrefix : Maybe String
    , locked : Bool
    , lockReason : Maybe GroupLockReason
    }


{-| Eligibility / failure codes for `FAIL E2EEGROUP <code>` (and
`WARN E2EEGROUP TEMPORARILY_UNAVAILABLE`), from
`onyx-client-contract.v2.json` `command_vectors.rejected`.
-}
type E2eGroupFail
    = FailNotLoggedIn
    | FailCapRequired
    | FailIrcxRequired
    | FailNotOnChannel
    | FailBadPayload
    | FailDeviceNotOwned
    | FailTargetUnavailable
    | FailSessionUnavailable
    | FailTemporarilyUnavailable


deliveryCommand : ControlKind -> String
deliveryCommand kind =
    case kind of
        KeyPackage ->
            "E2EE.KEYPACKAGE"

        Welcome ->
            "E2EE.WELCOME"

        Commit ->
            "E2EE.COMMIT"


deliveryKindFromCommand : String -> Maybe ControlKind
deliveryKindFromCommand command =
    case command of
        "E2EE.KEYPACKAGE" ->
            Just KeyPackage

        "E2EE.WELCOME" ->
            Just Welcome

        "E2EE.COMMIT" ->
            Just Commit

        _ ->
            Nothing


parseE2eGroupFail : String -> Maybe E2eGroupFail
parseE2eGroupFail code =
    case String.toUpper code of
        "NOT_LOGGED_IN" ->
            Just FailNotLoggedIn

        "CAP_REQUIRED" ->
            Just FailCapRequired

        "IRCX_REQUIRED" ->
            Just FailIrcxRequired

        "NOT_ON_CHANNEL" ->
            Just FailNotOnChannel

        "BAD_PAYLOAD" ->
            Just FailBadPayload

        "DEVICE_NOT_OWNED" ->
            Just FailDeviceNotOwned

        "TARGET_UNAVAILABLE" ->
            Just FailTargetUnavailable

        "SESSION_UNAVAILABLE" ->
            Just FailSessionUnavailable

        "TEMPORARILY_UNAVAILABLE" ->
            Just FailTemporarilyUnavailable

        _ ->
            Nothing


e2eGroupFailText : E2eGroupFail -> String
e2eGroupFailText fail =
    case fail of
        FailNotLoggedIn ->
            "sign in to use group encryption"

        FailCapRequired ->
            "the onyx/e2ee capability is required"

        FailIrcxRequired ->
            "IRCX authentication is required"

        FailNotOnChannel ->
            "you are not on that channel"

        FailBadPayload ->
            "malformed control payload"

        FailDeviceNotOwned ->
            "that device is not owned by your account"

        FailTargetUnavailable ->
            "the target device is unavailable"

        FailSessionUnavailable ->
            "no reusable E2EE session is available"

        FailTemporarilyUnavailable ->
            "group encryption is temporarily unavailable"


stripDeliveryLineEnd : String -> String
stripDeliveryLineEnd raw =
    let
        noNl =
            if String.endsWith "\n" raw then
                String.dropRight 1 raw

            else
                raw
    in
    if String.endsWith "\r" noNl then
        String.dropRight 1 noNl

    else
        noNl


splitAtFirstSpace : String -> Maybe ( String, String )
splitAtFirstSpace text =
    case String.indexes " " text of
        [] ->
            Nothing

        i :: _ ->
            Just ( String.slice 0 i text, String.dropLeft (i + 1) text )


validDeliveryPrefix : String -> Bool
validDeliveryPrefix prefix =
    not (String.isEmpty prefix)
        && List.all
            (\c ->
                let
                    code =
                        Char.toCode c
                in
                code > 0x20 && code /= 0x7F && c /= ','
            )
            (String.toList prefix)


splitDeliveryParams : String -> List String
splitDeliveryParams text =
    let
        trimmed =
            String.trimLeft text
    in
    if String.isEmpty trimmed then
        []

    else if String.startsWith ":" trimmed then
        [ String.dropLeft 1 trimmed ]

    else
        case splitAtFirstSpace trimmed of
            Nothing ->
                [ trimmed ]

            Just ( head, tail ) ->
                head :: splitDeliveryParams tail


lastParam : List String -> Maybe String
lastParam params =
    List.head (List.reverse params)


{-| Parse one raw inbound delivery line. Dotted verbs never survive the
`Wire` command grammar, so — mirroring `parseRawDeliveryLine` in the
oracle — tags are skipped, the server prefix is retained only as
provenance (never authentication), and the account-less legacy shape
resolves its sender through the explicit account only.
-}
parseDeliveryLine : String -> Maybe String -> Maybe Delivery
parseDeliveryLine line explicitFromAccount =
    let
        raw =
            stripDeliveryLineEnd line
    in
    if String.isEmpty raw || String.contains "\u{0000}" raw then
        Nothing

    else
        let
            afterTags =
                if String.startsWith "@" raw then
                    case splitAtFirstSpace raw of
                        Nothing ->
                            ""

                        Just ( _, tail ) ->
                            tail

                else
                    raw

            ( prefix, afterPrefix ) =
                if String.startsWith ":" afterTags then
                    case splitAtFirstSpace (String.dropLeft 1 afterTags) of
                        Nothing ->
                            ( Nothing, "" )

                        Just ( host, tail ) ->
                            if validDeliveryPrefix host then
                                ( Just host, tail )

                            else
                                ( Nothing, "" )

                else
                    ( Nothing, afterTags )

            ( verb, afterVerb ) =
                case splitAtFirstSpace afterPrefix of
                    Nothing ->
                        ( afterPrefix, "" )

                    Just pair ->
                        pair
        in
        case deliveryKindFromCommand (String.toUpper verb) of
            Nothing ->
                Nothing

            Just kind ->
                assembleDelivery (deliveryCommand kind) kind (splitDeliveryParams afterVerb) prefix explicitFromAccount


{-| Parse a delivery from an already-parsed message. When the command
itself is a dotted delivery verb the params/prefix apply directly;
otherwise the original bytes are re-parsed, mirroring `rawFromMessage`
(the `Wire` grammar yields `command == ""` for dotted verbs).
-}
parseDeliveryMessage : IrcMessage -> Maybe String -> Maybe Delivery
parseDeliveryMessage message explicitFromAccount =
    case deliveryKindFromCommand (String.toUpper message.command) of
        Just kind ->
            assembleDelivery (deliveryCommand kind) kind message.params message.prefix explicitFromAccount

        Nothing ->
            parseDeliveryLine message.raw explicitFromAccount


assembleDelivery : String -> ControlKind -> List String -> Maybe String -> Maybe String -> Maybe Delivery
assembleDelivery command kind params sourcePrefix explicitFromAccount =
    case lastParam params of
        Nothing ->
            Nothing

        Just payload ->
            if not (validPayload payload) then
                Nothing

            else
                let
                    isWelcome =
                        kind == Welcome

                    currentExpected =
                        if isWelcome then
                            6

                        else
                            4

                    legacyExpected =
                        if isWelcome then
                            5

                        else
                            3

                    paramCount =
                        List.length params
                in
                if paramCount /= currentExpected && paramCount /= legacyExpected then
                    Nothing

                else
                    let
                        hasWireAccount =
                            paramCount == currentExpected

                        fromAccount =
                            if hasWireAccount then
                                getParam 1 params

                            else
                                explicitFromAccount

                        fromDeviceIndex =
                            if hasWireAccount then
                                2

                            else
                                1

                        toAccountIndex =
                            if hasWireAccount then
                                3

                            else
                                2

                        toDeviceIndex =
                            if hasWireAccount then
                                4

                            else
                                3
                    in
                    case fromAccount of
                        Nothing ->
                            Nothing

                        Just account ->
                            if String.isEmpty account then
                                Nothing

                            else
                                let
                                    routing =
                                        { channel = Maybe.withDefault "" (getParam 0 params)
                                        , kind = kind
                                        , fromDevice = Maybe.withDefault "" (getParam fromDeviceIndex params)
                                        , fromAccount = account
                                        , toAccount =
                                            if isWelcome then
                                                getParam toAccountIndex params

                                            else
                                                Nothing
                                        , toDevice =
                                            if isWelcome then
                                                getParam toDeviceIndex params

                                            else
                                                Nothing
                                        }
                                in
                                case normalizeGroupControlRouting routing of
                                    Nothing ->
                                        Nothing

                                    Just normalized ->
                                        let
                                            parts =
                                                parseGroupControlPayload payload

                                            legacyPayload =
                                                case parts of
                                                    Nothing ->
                                                        True

                                                    Just parsed ->
                                                        parsed.version /= payloadVersion || parsed.diagnosticOnly

                                            locked =
                                                (not hasWireAccount) || legacyPayload

                                            lockReason =
                                                if not hasWireAccount then
                                                    Just MissingAccount

                                                else
                                                    case parts of
                                                        Nothing ->
                                                            Just BadPayload

                                                        Just parsed ->
                                                            if parsed.version /= payloadVersion || parsed.diagnosticOnly then
                                                                Just LegacyOgc1

                                                            else
                                                                Nothing
                                        in
                                        Just
                                            { command = command
                                            , channel = normalized.channel
                                            , kind = kind
                                            , fromAccount = normalized.fromAccount
                                            , fromDevice = normalized.fromDevice
                                            , toAccount = normalized.toAccount
                                            , toDevice = normalized.toDevice
                                            , payload = payload
                                            , sourcePrefix = sourcePrefix
                                            , locked = locked
                                            , lockReason = lockReason
                                            }



-- room provisioning projection


{-| Room control-plane status, mirroring `GroupControlRoomStatus` in
`groupControlRuntime.ts`. `RoomDirectoryPending` means the delivery
signature verified but signer trust (device directory / trusted signer)
has not admitted it yet — never treated as provisioned. `RoomPairPending`
awaits the commit+welcome pair that carries key material; key install
itself happens behind ports.
-}
type RoomStatus
    = RoomLocked
    | RoomDirectoryPending
    | RoomPairPending
    | RoomControlApplied
    | RoomRecoveryRequired
    | RoomRejected


type alias RoomProjection =
    { status : RoomStatus
    , epoch : Maybe Int
    }


{-| Epoch + signer material a ports install request needs, extracted
from the already-validated structural payload. Only current-version
payloads qualify: legacy envelopes parse for diagnostics but are never
trusted or verified.
-}
type alias InstallInfo =
    { epoch : Int
    , signerB64 : String
    }


installInfo : String -> Maybe InstallInfo
installInfo payload =
    case parseGroupControlPayload payload of
        Nothing ->
            Nothing

        Just parts ->
            if parts.version /= payloadVersion then
                Nothing

            else
                Just
                    { epoch = parts.epoch
                    , signerB64 = Base64Url.encode parts.signerPub
                    }



-- commit+welcome pairing


{-| Half-pair cap, mirroring `GROUP_CONTROL_RUNTIME_MAX_HALF_PAIRS`.
Beyond it records are refused, never evicting live pairs.
-}
maxHalfPairs : Int
maxHalfPairs =
    128


{-| One buffered half: routing plus the opaque payload. Payloads are
compared directly for duplicate/equivocation detection — the oracle's
routing fingerprint is an optimization of the same equality relation,
and authenticity was already verified before buffering.
-}
type alias PairRecord =
    { payload : String
    , signerB64 : String
    , fromAccount : String
    , fromDevice : String
    , toAccount : Maybe String
    , toDevice : Maybe String
    }


{-| One commit slot plus per-target welcomes. Welcomes fan out per
recipient device, so each target gets its own slot under one epoch;
the recipient binding (welcome target vs local identity) is enforced
at open time, once device identity exists — until then pairing is
structural and installs nothing.
-}
type alias ControlPair =
    { key : String
    , room : String
    , sender : String
    , fromDevice : String
    , epoch : Int
    , commit : Maybe PairRecord
    , welcomes : Dict String PairRecord
    , quarantined : Bool
    }


{-| Insertion-ordered pair buffer. `order` tracks first-seen keys
because `Dict` has no order of its own.
-}
type alias PairBuffer =
    { pairs : Dict String ControlPair
    , order : List String
    }


blankPairBuffer : PairBuffer
blankPairBuffer =
    { pairs = Dict.empty, order = [] }


{-| An admitted, verified, pin-trusted delivery offered to the buffer.
Key-packages have no pair role (their session queue is a later slice).
-}
type alias Pairable =
    { room : String
    , kind : ControlKind
    , fromAccount : String
    , fromDevice : String
    , toAccount : Maybe String
    , toDevice : Maybe String
    , payload : String
    , signerB64 : String
    , epoch : Int
    }


type PairEvent
    = PairHalf String
    | PairReady String (List String)
    | PairDuplicate String
    | PairEquivocated String
    | PairFull String
    | PairIgnored String


pairBaseKey : String -> String -> String -> Int -> String
pairBaseKey room sender device epoch =
    room ++ "\u{0000}" ++ sender ++ "\u{0000}" ++ device ++ "\u{0000}" ++ String.fromInt epoch


{-| True when the pair already holds this exact payload — an already
consumed retransmission, mirroring the oracle's coalesced duplicates.
-}
pairHasPayload : PairBuffer -> String -> String -> Bool
pairHasPayload buffer key payload =
    case Dict.get key buffer.pairs of
        Nothing ->
            False

        Just pair ->
            case pair.commit of
                Just record ->
                    if record.payload == payload then
                        True

                    else
                        List.any (\welcome -> welcome.payload == payload) (Dict.values pair.welcomes)

                Nothing ->
                    List.any (\welcome -> welcome.payload == payload) (Dict.values pair.welcomes)


{-| Welcome target slot, mirroring the target half of the oracle's
`pairKey` (canonical lowercase account plus raw device id).
-}
welcomeTargetKey : Maybe String -> Maybe String -> String
welcomeTargetKey toAccount toDevice =
    String.toLower (Maybe.withDefault "" toAccount) ++ "\u{0000}" ++ Maybe.withDefault "" toDevice


toPairRecord : Pairable -> PairRecord
toPairRecord item =
    { payload = item.payload
    , signerB64 = item.signerB64
    , fromAccount = item.fromAccount
    , fromDevice = item.fromDevice
    , toAccount = item.toAccount
    , toDevice = item.toDevice
    }


quarantinePair : ControlPair -> ControlPair
quarantinePair pair =
    { pair | quarantined = True, commit = Nothing, welcomes = Dict.empty }


insertPair : PairBuffer -> ControlPair -> PairBuffer
insertPair buffer pair =
    { pairs = Dict.insert pair.key pair buffer.pairs
    , order =
        if List.member pair.key buffer.order then
            buffer.order

        else
            buffer.order ++ [ pair.key ]
    }


{-| Look up a buffered pair by its base key. -}
getPair : PairBuffer -> String -> Maybe ControlPair
getPair buffer key =
    Dict.get key buffer.pairs


{-| Drop a buffered pair (consumed by an open attempt or superseded).
Order entries for dead keys are pruned so the insertion order never
leaks unboundedly.
-}
removePair : PairBuffer -> String -> PairBuffer
removePair buffer key =
    { pairs = Dict.remove key buffer.pairs
    , order = List.filter (\k -> k /= key) buffer.order
    }


{-| Buffer one trusted delivery. Duplicates coalesce, conflicting
payloads under one key quarantine the pair (payloads dropped, key
pinned — mirroring `quarantineHalfPair`), and a full buffer refuses
new keys without evicting live pairs.
-}
bufferDelivery : PairBuffer -> Pairable -> ( PairBuffer, PairEvent )
bufferDelivery buffer item =
    if item.kind == KeyPackage then
        ( buffer, PairIgnored (pairBaseKey item.room item.fromAccount item.fromDevice item.epoch) )

    else
        let
            key =
                pairBaseKey item.room item.fromAccount item.fromDevice item.epoch
        in
        case Dict.get key buffer.pairs of
            Just pair ->
                bufferIntoPair buffer pair item key

            Nothing ->
                if Dict.size buffer.pairs >= maxHalfPairs then
                    ( buffer, PairFull key )

                else
                    bufferIntoPair buffer
                        { key = key
                        , room = item.room
                        , sender = item.fromAccount
                        , fromDevice = item.fromDevice
                        , epoch = item.epoch
                        , commit = Nothing
                        , welcomes = Dict.empty
                        , quarantined = False
                        }
                        item
                        key


bufferIntoPair : PairBuffer -> ControlPair -> Pairable -> String -> ( PairBuffer, PairEvent )
bufferIntoPair buffer pair item key =
    if pair.quarantined then
        ( buffer, PairEquivocated key )

    else if item.kind == Commit then
        case pair.commit of
            Just existing ->
                if existing.payload == item.payload then
                    ( buffer, PairDuplicate key )

                else
                    ( insertPair buffer (quarantinePair pair), PairEquivocated key )

            Nothing ->
                let
                    next =
                        { pair | commit = Just (toPairRecord item) }

                    targets =
                        Dict.keys next.welcomes
                in
                if List.isEmpty targets then
                    ( insertPair buffer next, PairHalf key )

                else
                    ( insertPair buffer next, PairReady key targets )

    else
        let
            target =
                welcomeTargetKey item.toAccount item.toDevice
        in
        case Dict.get target pair.welcomes of
            Just existing ->
                if existing.payload == item.payload then
                    ( buffer, PairDuplicate key )

                else
                    ( insertPair buffer (quarantinePair pair), PairEquivocated key )

            Nothing ->
                let
                    next =
                        { pair | welcomes = Dict.insert target (toPairRecord item) pair.welcomes }
                in
                case next.commit of
                    Nothing ->
                        ( insertPair buffer next, PairHalf key )

                    Just _ ->
                        ( insertPair buffer next, PairReady key [ target ] )

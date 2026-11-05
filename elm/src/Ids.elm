module Ids exposing
    ( AccountGeneration
    , AccountId
    , AttachmentId
    , ConnectionGeneration
    , ConversationId
    , CredentialRef
    , EndpointId
    , LocalDropSid
    , LogicalGroupId
    , MessageId
    , NetworkId
    , NodeId
    , OwnerRef
    , RequestId
    , UnsignedDecimal
    , ReadMarkerTimestamp
    , HistoryTimestamp
    , WireTimestamp
    , accountGenerationFromInt
    , accountGenerationToInt
    , accountIdFromConfig
    , accountIdFromWire
    , accountIdToWire
    , attachmentIdFromWire
    , attachmentIdToWire
    , canonicalKey
    , connectionGenerationFromInt
    , connectionGenerationToInt
    , conversationIdFromWire
    , conversationIdToWire
    , credentialRefFromRuntime
    , credentialRefToRuntime
    , endpointIdFromConfig
    , endpointIdToWire
    , localDropSidFromWire
    , localDropSidToWire
    , logicalGroupIdFromWire
    , logicalGroupIdToWire
    , messageIdFromWire
    , messageIdToWire
    , messageStorageKey
    , networkAccountKey
    , networkIdFromConfig
    , networkIdToWire
    , nodeIdFromWire
    , nodeIdToWire
    , ownerRefFromRuntime
    , ownerRefToRuntime
    , ownerStorageKey
    , requestIdFromRuntime
    , requestIdToRuntime
    , unsignedDecimalFromWire
    , unsignedDecimalToWire
    , readMarkerTimestampFromWire
    , readMarkerTimestampToWire
    , historyTimestampFromWire
    , historyTimestampToWire
    , wireTimestampFromWire
    , wireTimestampToWire
    )

{-| Opaque boundary identifiers. Constructors are private; callers validate
at config, authenticated-wire, or private-runtime boundaries. Wire-sized
integer selectors and timestamps remain canonical strings, preserving digits
and fractional precision exactly. Attachment IDs and local-drop SIDs are
separate types despite their shared hexadecimal wire shape.
-}

import Char
import Json.Encode as Encode
import Regex
import String


type NetworkId = NetworkId String

type EndpointId = EndpointId String

type AccountId = AccountId String

type ConversationId = ConversationId String

type MessageId = MessageId String

type LogicalGroupId = LogicalGroupId String

type AttachmentId = AttachmentId String

type LocalDropSid = LocalDropSid String

type RequestId = RequestId String

type OwnerRef = OwnerRef String

type CredentialRef = CredentialRef String

type ConnectionGeneration = ConnectionGeneration Int
type AccountGeneration = AccountGeneration Int
type UnsignedDecimal = UnsignedDecimal String
type WireTimestamp = WireTimestamp String
type NodeId = NodeId String
type ReadMarkerTimestamp = ReadMarkerTimestamp String
type HistoryTimestamp = HistoryTimestamp String


networkIdFromConfig : String -> Maybe NetworkId
networkIdFromConfig value =
    if validOpaque value then Just (NetworkId value) else Nothing

networkIdToWire : NetworkId -> String
networkIdToWire (NetworkId value) = value

endpointIdFromConfig : String -> Maybe EndpointId
endpointIdFromConfig value =
    if validOpaque value then Just (EndpointId value) else Nothing

endpointIdToWire : EndpointId -> String
endpointIdToWire (EndpointId value) = value

accountIdFromWire : String -> Maybe AccountId
accountIdFromWire value =
    if validOpaque value && utf8Length value <= 64 then Just (AccountId value) else Nothing

accountIdFromConfig : String -> Maybe AccountId
accountIdFromConfig = accountIdFromWire

accountIdToWire : AccountId -> String
accountIdToWire (AccountId value) = value

conversationIdFromWire : String -> Maybe ConversationId
conversationIdFromWire value =
    if validOpaque value then Just (ConversationId value) else Nothing

conversationIdToWire : ConversationId -> String
conversationIdToWire (ConversationId value) = value

messageIdFromWire : String -> Maybe MessageId
messageIdFromWire value =
    if validOpaque value then Just (MessageId value) else Nothing

messageIdToWire : MessageId -> String
messageIdToWire (MessageId value) = value

logicalGroupIdFromWire : String -> Maybe LogicalGroupId
logicalGroupIdFromWire value =
    if validHex32 value then Just (LogicalGroupId (String.toLower value)) else Nothing

logicalGroupIdToWire : LogicalGroupId -> String
logicalGroupIdToWire (LogicalGroupId value) = value

attachmentIdFromWire : String -> Maybe AttachmentId
attachmentIdFromWire value =
    if validHex32 value then Just (AttachmentId (String.toLower value)) else Nothing

attachmentIdToWire : AttachmentId -> String
attachmentIdToWire (AttachmentId value) = value

localDropSidFromWire : String -> Maybe LocalDropSid
localDropSidFromWire value =
    if validHex32 value then Just (LocalDropSid (String.toLower value)) else Nothing

localDropSidToWire : LocalDropSid -> String
localDropSidToWire (LocalDropSid value) = value

requestIdFromRuntime : String -> Maybe RequestId
requestIdFromRuntime value =
    if validRuntimeRef value then Just (RequestId value) else Nothing

requestIdToRuntime : RequestId -> String
requestIdToRuntime (RequestId value) = value

ownerRefFromRuntime : String -> Maybe OwnerRef
ownerRefFromRuntime value =
    if validRuntimeRef value then Just (OwnerRef value) else Nothing

ownerRefToRuntime : OwnerRef -> String
ownerRefToRuntime (OwnerRef value) = value

credentialRefFromRuntime : String -> Maybe CredentialRef
credentialRefFromRuntime value =
    if validRuntimeRef value then Just (CredentialRef value) else Nothing

credentialRefToRuntime : CredentialRef -> String
credentialRefToRuntime (CredentialRef value) = value

connectionGenerationFromInt : Int -> Maybe ConnectionGeneration
connectionGenerationFromInt value =
    if value >= 0 then Just (ConnectionGeneration value) else Nothing

connectionGenerationToInt : ConnectionGeneration -> Int
connectionGenerationToInt (ConnectionGeneration value) = value

accountGenerationFromInt : Int -> Maybe AccountGeneration
accountGenerationFromInt value =
    if value >= 0 then Just (AccountGeneration value) else Nothing

accountGenerationToInt : AccountGeneration -> Int
accountGenerationToInt (AccountGeneration value) = value

unsignedDecimalFromWire : String -> Maybe UnsignedDecimal
unsignedDecimalFromWire value =
    let
        canonical = validU64 value
    in
    if canonical then Just (UnsignedDecimal value) else Nothing

unsignedDecimalToWire : UnsignedDecimal -> String
unsignedDecimalToWire (UnsignedDecimal value) = value

wireTimestampFromWire : String -> Maybe WireTimestamp
wireTimestampFromWire value =
    if validCalendarTimestamp value then Just (WireTimestamp value) else Nothing

wireTimestampToWire : WireTimestamp -> String
wireTimestampToWire (WireTimestamp value) = value

nodeIdFromWire : String -> Maybe NodeId
nodeIdFromWire value =
    case unsignedDecimalFromWire value of
        Just _ ->
            if value == "0" then Nothing else Just (NodeId value)

        Nothing ->
            Nothing

nodeIdToWire : NodeId -> String
nodeIdToWire (NodeId value) = value

readMarkerTimestampFromWire : String -> Maybe ReadMarkerTimestamp
readMarkerTimestampFromWire value =
    if validFixedTimestamp value && validCalendarTimestamp value then Just (ReadMarkerTimestamp value) else Nothing

readMarkerTimestampToWire : ReadMarkerTimestamp -> String
readMarkerTimestampToWire (ReadMarkerTimestamp value) = value

historyTimestampFromWire : String -> Maybe HistoryTimestamp
historyTimestampFromWire value =
    if validFixedTimestamp value && validCalendarTimestamp value && String.left 4 value >= "1970" then Just (HistoryTimestamp value) else Nothing

historyTimestampToWire : HistoryTimestamp -> String
historyTimestampToWire (HistoryTimestamp value) = value

validU64 : String -> Bool
validU64 value =
    let
        digits = String.toList value
        canonical = value == "0" || (not (String.startsWith "0" value) && not (List.isEmpty digits) && List.all isAsciiDigit digits)
        withinWidth = String.length value <= 20
        withinMax = String.length value < 20 || value <= "18446744073709551615"
    in
    canonical && withinWidth && withinMax

validFixedTimestamp : String -> Bool
validFixedTimestamp value =
    case Regex.fromString "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$" of
        Just regex -> Regex.contains regex value
        Nothing -> False

validCalendarTimestamp : String -> Bool
validCalendarTimestamp value =
    let
        pattern = Regex.fromString "^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\\.([0-9]+))?Z$"
    in
    case pattern of
        Nothing -> False
        Just regex ->
            case Regex.find regex value of
                [ match ] ->
                    case match.submatches of
                        [ Just yearText, Just monthText, Just dayText, Just hourText, Just minuteText, Just secondText, _ ] ->
                            let
                                year = Maybe.withDefault 0 (String.toInt yearText)
                                month = Maybe.withDefault 0 (String.toInt monthText)
                                day = Maybe.withDefault 0 (String.toInt dayText)
                                hour = Maybe.withDefault 99 (String.toInt hourText)
                                minute = Maybe.withDefault 99 (String.toInt minuteText)
                                second = Maybe.withDefault 99 (String.toInt secondText)
                                maxDay = daysInMonth year month
                            in
                            year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= maxDay && hour <= 23 && minute <= 59 && second <= 59
                        _ -> False
                _ -> False

daysInMonth : Int -> Int -> Int
daysInMonth year month =
    case month of
        1 -> 31
        2 -> if modBy 400 year == 0 || (modBy 4 year == 0 && modBy 100 year /= 0) then 29 else 28
        3 -> 31
        4 -> 30
        5 -> 31
        6 -> 30
        7 -> 31
        8 -> 31
        9 -> 30
        10 -> 31
        11 -> 30
        12 -> 31
        _ -> 0

isAsciiDigit : Char -> Bool
isAsciiDigit char = char >= '0' && char <= '9'


canonicalKey : List String -> String
canonicalKey values =
    Encode.list Encode.string values |> Encode.encode 0

networkAccountKey : NetworkId -> AccountId -> String
networkAccountKey network account =
    canonicalKey [ networkIdToWire network, accountIdToWire account ]

ownerStorageKey : OwnerRef -> String -> String
ownerStorageKey owner recordId =
    canonicalKey [ ownerRefToRuntime owner, recordId ]

messageStorageKey : NetworkId -> AccountId -> ConversationId -> MessageId -> String
messageStorageKey network account conversation message =
    canonicalKey [ networkIdToWire network, accountIdToWire account, conversationIdToWire conversation, messageIdToWire message ]


validOpaque : String -> Bool
validOpaque value =
    not (String.isEmpty value) && String.length value <= 512 && String.all isSafeChar value

utf8Length : String -> Int
utf8Length value =
    String.toList value
        |> List.map
            (\char ->
                let
                    code = Char.toCode char
                in
                if code <= 0x7F then 1 else if code <= 0x7FF then 2 else if code <= 0xFFFF then 3 else 4
            )
        |> List.sum

isSafeChar : Char -> Bool
isSafeChar char =
    let code = Char.toCode char in
    code > 32 && code /= 127

validHex32 : String -> Bool
validHex32 value =
    String.length value == 32 && String.toLower value /= "00000000000000000000000000000000" && String.all isHex value

isHex : Char -> Bool
isHex char =
    let code = Char.toCode (Char.toLower char) in
    (code >= Char.toCode '0' && code <= Char.toCode '9') || (code >= Char.toCode 'a' && code <= Char.toCode 'f')

validRuntimeRef : String -> Bool
validRuntimeRef value =
    String.length value >= 22 && String.length value <= 128 && String.all isBase64Url value

isBase64Url : Char -> Bool
isBase64Url char =
    let code = Char.toCode char in
    (code >= Char.toCode 'A' && code <= Char.toCode 'Z')
        || (code >= Char.toCode 'a' && code <= Char.toCode 'z')
        || (code >= Char.toCode '0' && code <= Char.toCode '9')
        || char == '_'
        || char == '-'

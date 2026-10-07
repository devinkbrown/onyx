module Schedule exposing
    ( ScheduleClaim
    , ScheduleDisplayState(..)
    , ScheduledMessage
    , ScheduledMessageOwner
    , maxSafeInt
    , maxScheduledChannelLength
    , maxScheduledIdLength
    , maxScheduledIdentityLength
    , maxScheduledMessages
    , maxScheduledServerLength
    , maxScheduledStorageLength
    , maxScheduledTextLength
    , canScheduleAt
    , canScheduleChannel
    , cancelScheduled
    , classifyScheduledMessage
    , createScheduledSend
    , decodeScheduledMessages
    , dueScheduled
    , encodeScheduledMessages
    , enqueueScheduled
    , ownedScheduledMessageCount
    , ownedScheduledMessages
    , parseScheduledMessages
    , purgeOutgoingScheduled
    , sameScheduleOwner
    , scheduleOwnerFor
    , selectDueMessages
    , claimToken
    , claimableRows
    , scheduledDispatchIntervalMs
    , trustedOwner
    , SchedulePreset
    , minScheduleLeadMs
    , maxScheduleLeadMs
    , isSchedulable
    , schedulePresets
    , canScheduleComposer
    , scheduleComposerRefusal
    , scheduledRowStateLabel
    )

{-| Scheduled-message ("send later") queue core, mirroring
`src/lib/schedule/dispatch.ts` (persistence parse + due/pending
split) and `src/lib/composer/scheduledSend.ts` (create / enqueue /
cancel / classify). Pure decision only: no clock, no storage, no
side effects. The firing loop, composer scheduling surface, and
sheet UI join in a later slice.
-}

import Dict exposing (Dict)
import Json.Decode as Decode
import Json.Encode as Encode


{-| Exact composing-session owner (mirroring `ScheduledMessageOwner`:
untrimmed values and over-long fields parse to no owner, and the
identity lowercases). -}
type alias ScheduledMessageOwner =
    { serverUrl : String
    , identity : String
    }


{-| Durable dispatcher claim, present only while async admission is
pending. -}
type alias ScheduleClaim =
    { token : String
    , claimedAt : Int
    }


{-| One queue row (mirroring `ScheduledMessage`). -}
type alias ScheduledMessage =
    { id : String
    , channel : String
    , text : String
    , sendAt : Int
    , owner : Maybe ScheduledMessageOwner
    , claim : Maybe ScheduleClaim
    , generation : Maybe Int
    , clearEpoch : Maybe Int
    }


{-| UI state derived only from locally observable facts, never
implying delivery (mirroring `ScheduledMessageDisplayState`). -}
type ScheduleDisplayState
    = ScheduleFuture
    | ScheduleOverdueDisconnected
    | ScheduleProtected
    | ScheduleEncryptionRequired
    | ScheduleDue


maxScheduledMessages : Int
maxScheduledMessages =
    256


maxScheduledIdLength : Int
maxScheduledIdLength =
    128


maxScheduledChannelLength : Int
maxScheduledChannelLength =
    256


maxScheduledTextLength : Int
maxScheduledTextLength =
    65536


maxScheduledStorageLength : Int
maxScheduledStorageLength =
    2 * 1024 * 1024


maxScheduledServerLength : Int
maxScheduledServerLength =
    2048


maxScheduledIdentityLength : Int
maxScheduledIdentityLength =
    256


{-| Largest exactly-representable integer (mirroring
`Number.isSafeInteger`). -}
maxSafeInt : Int
maxSafeInt =
    9007199254740991


{-| Safe positive epoch (mirroring `canScheduleAt`). -}
canScheduleAt : Int -> Bool
canScheduleAt sendAt =
    sendAt > 0 && sendAt <= maxSafeInt


{-| Channel token accepted by the queue (mirroring
`canScheduleChannel`: trimmed, bounded, no C0/space/DEL, never
`:`-led, no commas — the `[\u0000-\u0020]` range includes space). -}
canScheduleChannel : String -> Bool
canScheduleChannel channel =
    let
        target =
            String.trim channel
    in
    not (String.isEmpty target)
        && String.length target <= maxScheduledChannelLength
        && not (String.any (\c -> Char.toCode c <= 0x20 || Char.toCode c == 0x7F) target)
        && not (String.startsWith ":" target)
        && not (String.contains "," target)


{-| Create one row (mirroring `createScheduledSend`; the id is
caller-supplied — pure Elm takes no randomness, so the later
firing slice mints it ports-side). -}
createScheduledSend :
    { channel : String
    , text : String
    , sendAt : Int
    , owner : Maybe ScheduledMessageOwner
    , id : String
    }
    -> Maybe ScheduledMessage
createScheduledSend input =
    let
        channel =
            String.trim input.channel
    in
    if not (canScheduleChannel channel) then
        Nothing

    else if String.isEmpty (String.trim input.text) || String.length input.text > maxScheduledTextLength then
        Nothing

    else if not (canScheduleAt input.sendAt) then
        Nothing

    else if String.isEmpty input.id || String.length input.id > maxScheduledIdLength then
        Nothing

    else
        Just
            { id = input.id
            , channel = channel
            , text = input.text
            , sendAt = input.sendAt
            , owner = input.owner
            , claim = Nothing
            , generation = Nothing
            , clearEpoch = Nothing
            }


{-| Append one row sorted by `sendAt` (mirroring `enqueueScheduled`:
full queue or duplicate id refuses with `Nothing`, never mutates). -}
enqueueScheduled : List ScheduledMessage -> ScheduledMessage -> Maybe (List ScheduledMessage)
enqueueScheduled queue item =
    if List.length queue >= maxScheduledMessages then
        Nothing

    else if List.any (\row -> row.id == item.id) queue then
        Nothing

    else
        Just (List.sortBy .sendAt (queue ++ [ item ]))


{-| Remove one id (mirroring `cancelScheduled`: fresh list, no-op
when missing). -}
cancelScheduled : List ScheduledMessage -> String -> List ScheduledMessage
cancelScheduled queue id =
    List.filter (\row -> row.id /= id) queue


{-| Split due-now vs still-pending (mirroring `selectDueMessages`:
offline holds everything, including past-due rows, so a message
written while offline is never dropped). -}
selectDueMessages : List ScheduledMessage -> Int -> Bool -> { due : List ScheduledMessage, pending : List ScheduledMessage }
selectDueMessages messages now connected =
    if not connected then
        { due = [], pending = messages }

    else
        { due = List.filter (\m -> m.sendAt <= now) messages
        , pending = List.filter (\m -> m.sendAt > now) messages
        }


{-| Split with the store-queue naming (mirroring `dueScheduled`). -}
dueScheduled : List ScheduledMessage -> Int -> Bool -> { due : List ScheduledMessage, remaining : List ScheduledMessage }
dueScheduled queue now connected =
    let
        decision =
            selectDueMessages queue now connected
    in
    { due = decision.due, remaining = decision.pending }


{-| Display state from locally observable facts (mirroring
`classifyScheduledMessage`, same precedence). -}
classifyScheduledMessage :
    { sendAt : Int
    , now : Int
    , connected : Bool
    , protected : Bool
    , encryptionRequired : Bool
    }
    -> ScheduleDisplayState
classifyScheduledMessage input =
    if input.encryptionRequired then
        ScheduleEncryptionRequired

    else if input.protected then
        ScheduleProtected

    else if input.sendAt > input.now then
        ScheduleFuture

    else if input.connected then
        ScheduleDue

    else
        ScheduleOverdueDisconnected


{-| Parse the persisted queue as untrusted, version-drifting data
(mirroring `parseScheduledMessages`: fail-closed per row, first id
wins, capped at 256, sorted by `sendAt` with the id as tiebreak —
note the tiebreak uses Elm codepoint order where the oracle uses
`localeCompare`; ASCII-agreeing, exotic-diverging like the rest of
the codebase). -}
decodeScheduledMessages : Decode.Value -> List ScheduledMessage
decodeScheduledMessages value =
    case Decode.decodeValue (Decode.list Decode.value) value of
        Err _ ->
            []

        Ok rows ->
            finishRows rows


{-| Parse the persisted queue from its raw storage string (mirroring
`parseScheduledMessages`: empty/oversize storage parses to no rows —
the caller maps a missing key to `""`). -}
parseScheduledMessages : String -> List ScheduledMessage
parseScheduledMessages raw =
    if String.isEmpty raw || String.length raw > maxScheduledStorageLength then
        []

    else
        case Decode.decodeString (Decode.list Decode.value) raw of
            Err _ ->
                []

            Ok rows ->
                finishRows rows


finishRows : List Decode.Value -> List ScheduledMessage
finishRows rows =
    List.sortBy (\m -> ( m.sendAt, m.id )) (collectRows rows)


type alias RowAcc =
    { seen : List String
    , kept : List ScheduledMessage
    }


collectRows : List Decode.Value -> List ScheduledMessage
collectRows rows =
    collectRowsHelp rows { seen = [], kept = [] }


collectRowsHelp : List Decode.Value -> RowAcc -> List ScheduledMessage
collectRowsHelp rows acc =
    case rows of
        [] ->
            List.reverse acc.kept

        row :: rest ->
            if List.length acc.kept >= maxScheduledMessages then
                List.reverse acc.kept

            else
                case Decode.decodeValue rowDecoder row of
                    Err _ ->
                        collectRowsHelp rest acc

                    Ok message ->
                        if List.member message.id acc.seen then
                            collectRowsHelp rest acc

                        else
                            collectRowsHelp rest
                                { seen = message.id :: acc.seen
                                , kept = message :: acc.kept
                                }


{-| Strict row object: presence is significant — a present-but-bad
`generation`/`clearEpoch` drops the row (like the oracle `continue`),
while a present-but-bad `owner`/`claim` only clears that slot. -}
rowDecoder : Decode.Decoder ScheduledMessage
rowDecoder =
    Decode.dict Decode.value
        |> Decode.andThen
            (\fields ->
                case rowFromFields fields of
                    Just message ->
                        Decode.succeed message

                    Nothing ->
                        Decode.fail "bad row"
            )


rowFromFields : Dict String Decode.Value -> Maybe ScheduledMessage
rowFromFields fields =
    Maybe.andThen
        (\id ->
            Maybe.andThen
                (\channel ->
                    Maybe.andThen
                        (\text ->
                            Maybe.andThen
                                (\sendAt ->
                                    Maybe.andThen
                                        (\owner ->
                                            Maybe.andThen
                                                (\claim ->
                                                    Maybe.andThen
                                                        (\generation ->
                                                            Maybe.andThen
                                                                (\clearEpoch ->
                                                                    Just
                                                                        { id = id
                                                                        , channel = channel
                                                                        , text = text
                                                                        , sendAt = sendAt
                                                                        , owner = owner
                                                                        , claim = claim
                                                                        , generation = generation
                                                                        , clearEpoch = clearEpoch
                                                                        }
                                                                )
                                                                (optionalCheckedInt fields "clearEpoch" (\n -> n >= 0))
                                                        )
                                                        (optionalCheckedInt fields "generation" (\n -> n >= 0))
                                                )
                                                (optionalClaim fields)
                                        )
                                        (optionalOwner fields)
                                )
                                (requiredInt fields "sendAt" (\n -> n > 0))
                        )
                        (requiredString fields "text" (\text -> not (String.isEmpty (String.trim text)) && String.length text <= maxScheduledTextLength))
                )
                (requiredString fields "channel" (\channel -> not (String.isEmpty channel) && String.length channel <= maxScheduledChannelLength))
        )
        (requiredString fields "id" (\id -> not (String.isEmpty id) && String.length id <= maxScheduledIdLength))


requiredString : Dict String Decode.Value -> String -> (String -> Bool) -> Maybe String
requiredString fields field ok =
    case Dict.get field fields of
        Just raw ->
            case Decode.decodeValue Decode.string raw of
                Ok value ->
                    if ok value then
                        Just value

                    else
                        Nothing

                Err _ ->
                    Nothing

        Nothing ->
            Nothing


requiredInt : Dict String Decode.Value -> String -> (Int -> Bool) -> Maybe Int
requiredInt fields field ok =
    case Dict.get field fields of
        Just raw ->
            case Decode.decodeValue Decode.int raw of
                Ok n ->
                    if abs n <= maxSafeInt && ok n then
                        Just n

                    else
                        Nothing

                Err _ ->
                    Nothing

        Nothing ->
            Nothing


{-| Absent slot succeeds; present-but-bad drops the whole row. -}
optionalCheckedInt : Dict String Decode.Value -> String -> (Int -> Bool) -> Maybe (Maybe Int)
optionalCheckedInt fields field ok =
    case Dict.get field fields of
        Nothing ->
            Just Nothing

        Just raw ->
            case Decode.decodeValue Decode.int raw of
                Ok n ->
                    if abs n <= maxSafeInt && ok n then
                        Just (Just n)

                    else
                        Nothing

                Err _ ->
                    Nothing


optionalOwner : Dict String Decode.Value -> Maybe (Maybe ScheduledMessageOwner)
optionalOwner fields =
    case Dict.get "owner" fields of
        Nothing ->
            Just Nothing

        Just raw ->
            Just (decodeOwner raw)


decodeOwner : Decode.Value -> Maybe ScheduledMessageOwner
decodeOwner raw =
    case Decode.decodeValue (Decode.map2 Tuple.pair (Decode.field "serverUrl" Decode.string) (Decode.field "identity" Decode.string)) raw of
        Err _ ->
            Nothing

        Ok ( serverUrl, identity ) ->
            if
                String.isEmpty serverUrl
                    || String.length serverUrl > maxScheduledServerLength
                    || serverUrl /= String.trim serverUrl
                    || String.isEmpty identity
                    || String.length identity > maxScheduledIdentityLength
                    || identity /= String.trim identity
            then
                Nothing

            else
                Just { serverUrl = serverUrl, identity = String.toLower identity }


optionalClaim : Dict String Decode.Value -> Maybe (Maybe ScheduleClaim)
optionalClaim fields =
    case Dict.get "claim" fields of
        Nothing ->
            Just Nothing

        Just raw ->
            Just (decodeClaim raw)


decodeClaim : Decode.Value -> Maybe ScheduleClaim
decodeClaim raw =
    case Decode.decodeValue (Decode.map2 Tuple.pair (Decode.field "token" Decode.string) (Decode.field "claimedAt" Decode.int)) raw of
        Err _ ->
            Nothing

        Ok ( token, claimedAt ) ->
            if
                String.isEmpty token
                    || String.length token > maxScheduledIdLength
                    || claimedAt <= 0
                    || abs claimedAt > maxSafeInt
            then
                Nothing

            else
                Just { token = token, claimedAt = claimedAt }


{-| Derive the composing-session owner (mirroring
`_scheduledMessageOwner`: trimmed endpoint plus the trimmed,
lowercased account-or-nick identity; empty either way parses to no
owner). -}
scheduleOwnerFor : String -> Maybe String -> String -> Maybe ScheduledMessageOwner
scheduleOwnerFor serverUrl maybeAccount nick =
    let
        url =
            String.trim serverUrl

        identity =
            String.toLower (String.trim (Maybe.withDefault nick maybeAccount))
    in
    if String.isEmpty url || String.isEmpty identity then
        Nothing

    else
        Just { serverUrl = url, identity = identity }


{-| Owner equality (mirroring `_sameScheduledMessageOwner`: a missing
row owner never matches). -}
sameScheduleOwner : Maybe ScheduledMessageOwner -> ScheduledMessageOwner -> Bool
sameScheduleOwner actual expected =
    case actual of
        Just owner ->
            owner.serverUrl == expected.serverUrl && owner.identity == expected.identity

        Nothing ->
            False


{-| Rows visible/actionable under one identity (mirroring
`selectOwnedScheduledMessages`: no owner sees no rows, and legacy
owner-less rows stay out — preserved but never auto-dispatched). -}
ownedScheduledMessages : List ScheduledMessage -> Maybe ScheduledMessageOwner -> List ScheduledMessage
ownedScheduledMessages rows owner =
    case owner of
        Just current ->
            List.filter (\row -> sameScheduleOwner row.owner current) rows

        Nothing ->
            []


{-| Stable count for queue badges (mirroring
`selectOwnedScheduledMessageCount`). -}
ownedScheduledMessageCount : List ScheduledMessage -> Maybe ScheduledMessageOwner -> Int
ownedScheduledMessageCount rows owner =
    List.length (ownedScheduledMessages rows owner)


{-| Drop the logging-out identity's rows (mirroring the
`_resetAccountPrivateMessageState` purge: only the outgoing owner's
rows go — other identities' rows survive the switch, and a missing
owner changes nothing). -}
purgeOutgoingScheduled : List ScheduledMessage -> Maybe ScheduledMessageOwner -> { kept : List ScheduledMessage, changed : Bool }
purgeOutgoingScheduled rows outgoing =
    case outgoing of
        Just owner ->
            let
                kept =
                    List.filter (\row -> not (sameScheduleOwner row.owner owner)) rows
            in
            { kept = kept, changed = List.length kept /= List.length rows }

        Nothing ->
            { kept = rows, changed = False }


{-| Serialize the queue projection (mirroring `_persistScheduledMessages`
`JSON.stringify`: absent slots stay absent, so a decode round-trips). -}
encodeScheduledMessages : List ScheduledMessage -> Encode.Value
encodeScheduledMessages rows =
    Encode.list encodeScheduledMessage rows


encodeScheduledMessage : ScheduledMessage -> Encode.Value
encodeScheduledMessage row =
    Encode.object
        ([ ( "id", Encode.string row.id )
         , ( "channel", Encode.string row.channel )
         , ( "text", Encode.string row.text )
         , ( "sendAt", Encode.int row.sendAt )
         ]
            ++ encodeMaybe "owner" encodeOwner row.owner
            ++ encodeMaybe "claim" encodeClaim row.claim
            ++ encodeMaybe "generation" Encode.int row.generation
            ++ encodeMaybe "clearEpoch" Encode.int row.clearEpoch
        )


encodeMaybe : String -> (a -> Encode.Value) -> Maybe a -> List ( String, Encode.Value )
encodeMaybe field encode value =
    case value of
        Just present ->
            [ ( field, encode present ) ]

        Nothing ->
            []


encodeOwner : ScheduledMessageOwner -> Encode.Value
encodeOwner owner =
    Encode.object
        [ ( "serverUrl", Encode.string owner.serverUrl )
        , ( "identity", Encode.string owner.identity )
        ]


encodeClaim : ScheduleClaim -> Encode.Value
encodeClaim claim =
    Encode.object
        [ ( "token", Encode.string claim.token )
        , ( "claimedAt", Encode.int claim.claimedAt )
        ]


{-| Dispatcher cadence (mirroring `_SCHED_DISPATCH_MS`). -}
scheduledDispatchIntervalMs : Int
scheduledDispatchIntervalMs =
    15000


{-| Mint one dispatcher claim token (mirroring
`` `claim-${Date.now()}-${++seq}` `` — the sequence suffix keeps
tokens unique within the millisecond). -}
claimToken : Int -> Int -> String
claimToken nowMs seq =
    "claim-" ++ String.fromInt nowMs ++ "-" ++ String.fromInt seq


{-| Rows ready for a claim attempt (mirroring the dispatcher's
`claimable` filter: owned by the current identity, past due, and
with no outstanding claim — a present claim is the durable
uncertainty marker, so claimed rows never auto-retry). Sorted for
the claim round like the oracle's due sort. -}
claimableRows : List ScheduledMessage -> Maybe ScheduledMessageOwner -> Int -> List ScheduledMessage
claimableRows rows owner nowMs =
    case owner of
        Just current ->
            List.sortBy (\m -> ( m.sendAt, m.id ))
                (List.filter
                    (\row ->
                        row.sendAt <= nowMs && row.claim == Nothing && sameScheduleOwner row.owner current
                    )
                    rows
                )

        Nothing ->
            []


{-| Owner echo from a ports response (trimmed, lowercased, nonempty —
length bounds live at the persistence boundary, which revalidates;
equality here only gates toasts and row matching). -}
trustedOwner : String -> String -> Maybe ScheduledMessageOwner
trustedOwner serverUrl identity =
    let
        url =
            String.trim serverUrl

        name =
            String.toLower (String.trim identity)
    in
    if String.isEmpty url || String.isEmpty name then
        Nothing

    else
        Just { serverUrl = url, identity = name }


{-| A send must be at least this far out to be worth queuing
(mirroring `MIN_LEAD_MS`). -}
minScheduleLeadMs : Int
minScheduleLeadMs =
    30000


{-| Guard against absurd inputs so a fat-fingered value can't queue
(mirroring `MAX_LEAD_MS`: a year). Written as a product so no
single literal leaves the exact integer range. -}
maxScheduleLeadMs : Int
maxScheduleLeadMs =
    365 * 24 * 60 * 60 * 1000


{-| True when `epoch` is far enough out and not absurdly far to be
scheduled (mirroring `isSchedulable`). The oracle also refuses
non-finite epochs; Elm's `Int` cannot hold one, so that refusal is
by construction here. -}
isSchedulable : Int -> Int -> Bool
isSchedulable epoch now =
    let
        delta =
            epoch - now
    in
    delta >= minScheduleLeadMs && delta <= maxScheduleLeadMs


{-| One composer preset (mirroring `SCHEDULE_PRESETS`): the `offsetMs`
is the send lead for the relative presets; `tomorrow-9` needs the
local wall clock, so its epoch arrives from the ports clock answer
and stays `Nothing` until then. -}
type alias SchedulePreset =
    { id : String
    , label : String
    , offsetMs : Maybe Int
    }


{-| Preset table in oracle order (mirroring `SCHEDULE_PRESETS`
ids and labels verbatim). -}
schedulePresets : List SchedulePreset
schedulePresets =
    [ { id = "in-15m", label = "In 15 minutes", offsetMs = Just (15 * 60 * 1000) }
    , { id = "in-1h", label = "In 1 hour", offsetMs = Just (60 * 60 * 1000) }
    , { id = "in-3h", label = "In 3 hours", offsetMs = Just (3 * 60 * 60 * 1000) }
    , { id = "tomorrow-9", label = "Tomorrow, 9:00", offsetMs = Nothing }
    ]


{-| Whether the composer may offer send-later for this target and
draft (mirroring `canSchedule`: a present target plus trimmed,
nonempty, non-slash body — slash commands are never queued since
replaying a stale command would execute, not send). Editing and
staged attachments block first, in the oracle's order. -}
canScheduleComposer : { target : Maybe String, body : String, editing : Bool, attachmentsStaged : Bool } -> Bool
canScheduleComposer input =
    if input.editing || input.attachmentsStaged then
        False

    else
        case input.target of
            Nothing ->
                False

            Just target ->
                let
                    body =
                        String.trim input.body
                in
                not (String.isEmpty target)
                    && not (String.isEmpty body)
                    && not (String.startsWith "/" body)


{-| Why send-later is unavailable, mirroring
`scheduleDisabledReason` (same order, same copy): editing, then
attachments, then target, then body, then slash. -}
scheduleComposerRefusal : { target : Maybe String, body : String, editing : Bool, attachmentsStaged : Bool } -> Maybe String
scheduleComposerRefusal input =
    if canScheduleComposer input then
        Nothing

    else if input.editing then
        Just "Finish editing before scheduling."

    else if input.attachmentsStaged then
        Just "Remove attachments to schedule plain text."

    else
        case input.target of
            Nothing ->
                Just "Choose a room or message to schedule."

            Just target ->
                if String.isEmpty target then
                    Just "Choose a room or message to schedule."

                else
                    let
                        body =
                            String.trim input.body
                    in
                    if String.isEmpty body then
                        Just "Type a message before scheduling."

                    else if String.startsWith "/" body then
                        Just "Slash commands cannot be scheduled."

                    else
                        Just "Scheduling unavailable."


{-| Row state copy for the sheet (mirroring the sheet's `stateLabel`:
a claimed row reads uncertain even when its classifier says
otherwise, since the claim is the durable uncertainty marker). -}
scheduledRowStateLabel : Bool -> ScheduleDisplayState -> String
scheduledRowStateLabel claimed state =
    if claimed then
        "Sending; delivery is uncertain"

    else
        case state of
            ScheduleFuture ->
                "Saved; waiting for its time"

            ScheduleOverdueDisconnected ->
                "Waiting for connection"

            ScheduleProtected ->
                "Waiting for room protection"

            ScheduleEncryptionRequired ->
                "Waiting for encryption"

            ScheduleDue ->
                "Due; awaiting send"

module VaultImport exposing
    ( VaultImportMessage
    , VaultImportSnapshot
    , VaultImportTarget
    , maxExportRawMessages
    , maxExportTargets
    , maxExportTotalRawMessages
    , maxMessageIdLength
    , maxMessageTextLength
    , maxMessageTypeLength
    , maxSenderLength
    , maxTargetLength
    , maxTimestampLength
    , messageTypes
    , normalizeTarget
    , parseVaultExport
    )

{-| Vault export-snapshot import validation, mirroring the pure oracle
`parseVaultExport` in `src/lib/vault/historyVault.ts`. Unknown JSON is
validated and normalised before it can ever reach the vault: the
`onyx-vault` kind/version gate, the 4096-target / 1600-per-target /
16384-total work ceilings, per-target newest-tail slicing, strict row
validation (id/from/text/type/time/target bounds), and last-wins id
dedupe in first-appearance order.

Two documented narrowings follow from the Elm vault's flat row model
(`VaultRow`: id/target/from/body/at/rowType — the same shape
`ports.js` `exportSnapshot` emits, in oracle field names):

  - Display extras the oracle revives (reactions, replyTo, flags,
    topic) are not carried: they never reject a message in the oracle
    either, and the flat store cannot persist them. Replayed
    presence lines revive as `system` (the merge drops their
    join/part/kind upstream).
  - `time` accepts epoch-ms numbers or the strict ISO-8601 subset
    (`SavedSearches.parseIsoMillis`); other `Date.parse`-able forms
    are rejected rather than falling back, and an absent/invalid
    `exportedAt` becomes `""` instead of "now" (no clock in a pure
    fold — the caller stamps when it needs one).

There is no file-pick UI in the Elm client yet, so nothing calls this
parser — the executable spec in `tests/VaultImportTest.elm` pins the
contract for the coming merge path, which will write the projected
rows through the existing `vaultPut` port (whose trim already applies
the destination retention policy, matching the oracle's
import-obeys-policy order).
-}

import Dict
import Json.Decode as Decode
import SavedSearches
import Set


{-| Conversation cap per snapshot (bounds target-entry scanning). -}
maxExportTargets : Int
maxExportTargets =
    4096


{-| Per-target revive ceiling (4x headroom over the flat keep). -}
maxExportRawMessages : Int
maxExportRawMessages =
    1600


{-| Total revive ceiling across all targets in one blob. -}
maxExportTotalRawMessages : Int
maxExportTotalRawMessages =
    16384


{-| Bounds mirrored from the oracle vault caps. -}
maxTargetLength : Int
maxTargetLength =
    512


maxMessageIdLength : Int
maxMessageIdLength =
    512


maxSenderLength : Int
maxSenderLength =
    256


maxMessageTextLength : Int
maxMessageTextLength =
    64 * 1024


maxMessageTypeLength : Int
maxMessageTypeLength =
    16


maxTimestampLength : Int
maxTimestampLength =
    64


{-| Message types the vault round-trips. -}
messageTypes : Set.Set String
messageTypes =
    Set.fromList
        [ "msg"
        , "action"
        , "notice"
        , "join"
        , "part"
        , "quit"
        , "kick"
        , "mode"
        , "topic"
        , "nick"
        , "system"
        , "error"
        , "whisper"
        ]


{-| One revived message projected onto the flat vault row shape
(the validated `type` rides along so the row the merge writes
round-trips back through strict import). -}
type alias VaultImportMessage =
    { id : String
    , target : String
    , from : String
    , body : String
    , atMs : Float
    , msgType : String
    }


{-| One validated conversation. -}
type alias VaultImportTarget =
    { target : String
    , messages : List VaultImportMessage
    }


{-| A validated export snapshot ready to merge. -}
type alias VaultImportSnapshot =
    { exportedAt : String
    , targets : List VaultImportTarget
    }


{-| Untrusted per-message JSON before validation. -}
type alias RawMessage =
    { id : Maybe String
    , from : Maybe String
    , body : Maybe String
    , messageType : Maybe String
    , time : Maybe Float
    , target : Maybe String
    }


{-| Untrusted per-target JSON before validation. -}
type alias RawTarget =
    { target : Maybe String
    , messages : Maybe (List Decode.Value)
    }


{-| A control character for the wire-token check (C0 or DEL). -}
isControlChar : Char -> Bool
isControlChar c =
    let
        code =
            Char.toCode c
    in
    code <= 0x20 || code == 0x7F


{-| Bounded wire token: non-empty unless allowed, length-capped, no
control characters. -}
isBoundedWireToken : Maybe String -> Int -> Bool -> Bool
isBoundedWireToken value maxLength allowEmpty =
    case value of
        Nothing ->
            False

        Just s ->
            (allowEmpty || not (String.isEmpty s))
                && String.length s <= maxLength
                && not (String.any isControlChar s)


{-| Target names admit no whitespace at all (space, tab, CR, LF, NUL).
The length gate runs before trimming so a hostile multi-megabyte
string cannot force an unbounded allocation. -}
isTargetBadChar : Char -> Bool
isTargetBadChar c =
    c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == '\u{0000}'


{-| Normalise a target name against a fallback: a present string wins
unless it is blank after trimming (over-long input rejects outright,
even when a valid fallback exists). The survivor must be non-empty,
length-capped, and whitespace-free. -}
normalizeTarget : Maybe String -> String -> Maybe String
normalizeTarget raw fallback =
    let
        candidate =
            case raw of
                Just s ->
                    if String.length s > maxTargetLength then
                        Nothing

                    else if String.isEmpty (String.trim s) then
                        Just fallback

                    else
                        Just s

                Nothing ->
                    Just fallback
    in
    case candidate of
        Nothing ->
            Nothing

        Just c ->
            let
                trimmed =
                    String.trim c
            in
            if String.isEmpty trimmed || String.length trimmed > maxTargetLength || String.any isTargetBadChar trimmed then
                Nothing

            else
                Just trimmed


{-| Decode one message's `time`: epoch-ms numbers pass through, short
strings go through the strict ISO subset, anything else rejects. -}
timeDecoder : Decode.Decoder (Maybe Float)
timeDecoder =
    Decode.oneOf
        [ Decode.map Just Decode.float
        , Decode.string |> Decode.andThen (\s -> Decode.succeed (stringTimeMillis s))
        , Decode.succeed Nothing
        ]


stringTimeMillis : String -> Maybe Float
stringTimeMillis s =
    if String.length s > maxTimestampLength then
        Nothing

    else
        SavedSearches.parseIsoMillis s


rawMessageDecoder : Decode.Decoder RawMessage
rawMessageDecoder =
    Decode.map6 RawMessage
        (Decode.maybe (Decode.field "id" Decode.string))
        (Decode.maybe (Decode.field "from" Decode.string))
        (Decode.maybe (Decode.field "text" Decode.string))
        (Decode.maybe (Decode.field "type" Decode.string))
        (Decode.field "time" timeDecoder)
        (Decode.maybe (Decode.field "target" Decode.string))


{-| Validate one message against its conversation fallback target.
Rejects on bad id/from/text/type/time/target; projects onto the flat
vault row. -}
reviveMessage : RawMessage -> String -> Maybe VaultImportMessage
reviveMessage raw fallbackTarget =
    let
        typeOk =
            case raw.messageType of
                Nothing ->
                    False

                Just t ->
                    String.length t <= maxMessageTypeLength && Set.member t messageTypes
    in
    if not (isBoundedWireToken raw.id maxMessageIdLength False) then
        Nothing

    else if not (isBoundedWireToken raw.from maxSenderLength True) then
        Nothing

    else
        case ( raw.body, raw.time, raw.messageType ) of
            ( Just body, Just atMs, Just messageType ) ->
                if String.length body > maxMessageTextLength || not typeOk then
                    Nothing

                else
                    case ( normalizeTarget raw.target fallbackTarget, raw.id, raw.from ) of
                        ( Just target, Just id, Just from ) ->
                            Just { id = id, target = target, from = from, body = body, atMs = atMs, msgType = messageType }

                        _ ->
                            Nothing

            _ ->
                Nothing


rawTargetDecoder : Decode.Decoder RawTarget
rawTargetDecoder =
    Decode.map2 RawTarget
        (Decode.maybe (Decode.field "target" Decode.string))
        (Decode.maybe (Decode.field "messages" (Decode.list Decode.value)))


{-| Collapse duplicate ids deterministically: last occurrence wins
(matching the `put`-overwrite a re-import would produce) while
insertion order follows first appearance, so a clean export
round-trips in place. -}
dedupeById : List VaultImportMessage -> List VaultImportMessage
dedupeById messages =
    let
        step message ( byId, order ) =
            ( Dict.insert message.id message byId
            , if Dict.member message.id byId then
                order

              else
                order ++ [ message.id ]
            )
    in
    case List.foldl step ( Dict.empty, [] ) messages of
        ( byId, order ) ->
            List.filterMap (\id -> Dict.get id byId) order


{-| Fold one raw target: skip non-conforming entries without consuming
work; otherwise take the newest-tail slice (bounded by the remaining
global budget), revive, dedupe, and append. Stops opening new targets
once the budget is spent. -}
foldTarget : RawTarget -> ( List VaultImportTarget, Int ) -> ( List VaultImportTarget, Int )
foldTarget raw ( done, remaining ) =
    if remaining <= 0 then
        ( done, remaining )

    else
        case raw.messages of
            Nothing ->
                ( done, remaining )

            Just values ->
                case normalizeTarget raw.target "" of
                    Nothing ->
                        ( done, remaining )

                    Just target ->
                        let
                            lowered =
                                String.toLower target

                            targetWork =
                                min maxExportRawMessages remaining

                            tail =
                                List.drop (List.length values - targetWork) values

                            revived =
                                List.filterMap
                                    (\value ->
                                        case Decode.decodeValue rawMessageDecoder value of
                                            Ok rawMessage ->
                                                reviveMessage rawMessage lowered

                                            Err _ ->
                                                Nothing
                                    )
                                    tail
                        in
                        ( done ++ [ { target = lowered, messages = dedupeById revived } ]
                        , remaining - List.length tail
                        )


{-| Validate and normalize unknown JSON before it can be imported into
the vault. `Nothing` on a wrong kind/version shape; otherwise the
snapshot with per-target validated rows. -}
parseVaultExport : Decode.Value -> Maybe VaultImportSnapshot
parseVaultExport value =
    let
        snapshotDecoder =
            Decode.map3
                (\kind version targets ->
                    if kind /= "onyx-vault" then
                        Nothing

                    else if version /= 1 then
                        Nothing

                    else
                        Just targets
                )
                (Decode.field "kind" Decode.string)
                (Decode.field "version" Decode.int)
                (Decode.field "targets" (Decode.list Decode.value))
    in
    case Decode.decodeValue snapshotDecoder value of
        Err _ ->
            Nothing

        Ok Nothing ->
            Nothing

        Ok (Just rawTargets) ->
            let
                rawDecoded =
                    List.filterMap
                        (\targetValue ->
                            case Decode.decodeValue rawTargetDecoder targetValue of
                                Ok raw ->
                                    Just raw

                                Err _ ->
                                    Nothing
                        )
                        (List.take maxExportTargets rawTargets)

                ( targets, _ ) =
                    List.foldl foldTarget ( [], maxExportTotalRawMessages ) rawDecoded
            in
            Just
                { exportedAt = exportStamp value
                , targets = targets
                }


{-| Validated `exportedAt`, or `""` when absent or unparseable (the
oracle stamps "now"; a pure fold carries no clock, so the caller
stamps when it needs one). -}
exportStamp : Decode.Value -> String
exportStamp value =
    case Decode.decodeValue (Decode.maybe (Decode.field "exportedAt" Decode.string)) value of
        Ok (Just stamp) ->
            if String.length stamp <= maxTimestampLength then
                case SavedSearches.parseIsoMillis stamp of
                    Just _ ->
                        stamp

                    Nothing ->
                        ""

            else
                ""

        _ ->
            ""

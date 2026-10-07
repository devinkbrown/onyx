module GroupCommit exposing
    ( GroupCommit
    , buildGroupCommitContext
    , commitHashPreimage
    , decodeGroupCommitBase64url
    , decodeGroupCommitBytes
    , encodeGroupCommit
    , encodeGroupCommitBase64url
    , groupCommitBytes
    , groupCommitHashBytes
    , groupCommitIdBytes
    , groupCommitKeyBytes
    , groupCommitMaxB64url
    , groupCommitVersion
    , validRecord
    )

{-| OGCMT2 group-commit codec — Elm port of `lib/e2ee/groupCommit.ts`
(shape validation, exact 151-byte encode, strict decode, canonical
context / hash-preimage builders).

Hashing and key handling stay behind ports: `commitHashPreimage`
builds the exact `SHA-256(domain || 0x00 || context || body)` preimage
for the hash port, and the epoch-key commitment is computed wholly
inside the crypto port (the raw key never crosses into Elm — not even
transiently). What Elm owns is byte-exactness: magic, version,
field offsets, u64be epochs, and canonical base64url round-trips.

Epoch divergence: the oracle stores u64 epochs (bigint). Elm `Int` is
32-bit, so decode rejects epochs past 2^31-1 and encode only emits
non-negative `Int` epochs — fail-closed, matching the convention in
`GroupControl.validControlEpoch`. Commit epochs increment from 0/1,
so the cap is unreachable in practice.

-}

import Base64Url
import Keyring


groupCommitVersion : Int
groupCommitVersion =
    1


groupCommitBytes : Int
groupCommitBytes =
    151


groupCommitHashBytes : Int
groupCommitHashBytes =
    32


groupCommitIdBytes : Int
groupCommitIdBytes =
    32


groupCommitKeyBytes : Int
groupCommitKeyBytes =
    32


groupCommitMaxB64url : Int
groupCommitMaxB64url =
    256


magicBytes : List Int
magicBytes =
    [ 79, 71, 67, 77, 84, 50 ]


contextDomain : List Int
contextDomain =
    domainBytes "ONYX-GROUP-COMMIT-v1"


hashDomain : List Int
hashDomain =
    domainBytes "ONYX-GROUP-COMMIT-HASH-v1"


domainBytes : String -> List Int
domainBytes text =
    List.map Char.toCode (String.toList text)


type alias GroupCommit =
    { priorEpoch : Int
    , nextEpoch : Int
    , priorCommitHash : List Int
    , commitId : List Int
    , membershipDigest : List Int
    , newEpochKeyCommitment : List Int
    }


validBytes : List Int -> Bool
validBytes bytes =
    List.all (\b -> b >= 0 && b <= 255) bytes


validFixed : List Int -> Bool
validFixed bytes =
    List.length bytes == groupCommitHashBytes && validBytes bytes


nonZero : List Int -> Bool
nonZero bytes =
    List.any (\b -> b /= 0) bytes


validNonZeroFixed : List Int -> Bool
validNonZeroFixed bytes =
    validFixed bytes && nonZero bytes


validRecord : GroupCommit -> Bool
validRecord record =
    record.priorEpoch
        >= 0
        && record.nextEpoch
        > record.priorEpoch
        && validFixed record.priorCommitHash
        && (record.priorEpoch == 0 || nonZero record.priorCommitHash)
        && validNonZeroFixed record.commitId
        && validNonZeroFixed record.membershipDigest
        && validNonZeroFixed record.newEpochKeyCommitment


writeU64be : Int -> List Int
writeU64be epoch =
    [ 0, 0, 0, 0
    , modBy 256 (epoch // 16777216)
    , modBy 256 (epoch // 65536)
    , modBy 256 (epoch // 256)
    , modBy 256 epoch
    ]


{-| Fail-closed u64be read: any value past 2^31-1 is `Nothing`.
-}
readU64be : List Int -> Maybe Int
readU64be bytes =
    if List.length bytes /= 8 then
        Nothing

    else
        List.foldl
            (\byte acc ->
                case acc of
                    Nothing ->
                        Nothing

                    Just value ->
                        if byte < 0 || byte > 255 then
                            Nothing

                        else if value > (2147483647 - byte) // 256 then
                            Nothing

                        else
                            Just (value * 256 + byte)
            )
            (Just 0)
            bytes


{-| Encode the exact 151-byte OGCMT2 body. `Nothing` on any ambiguity.
-}
encodeGroupCommit : GroupCommit -> Maybe (List Int)
encodeGroupCommit record =
    if not (validRecord record) then
        Nothing

    else
        Just
            (magicBytes
                ++ [ groupCommitVersion ]
                ++ writeU64be record.priorEpoch
                ++ writeU64be record.nextEpoch
                ++ record.priorCommitHash
                ++ record.commitId
                ++ record.membershipDigest
                ++ record.newEpochKeyCommitment
            )


{-| Canonical unpadded base64url body for an OGC1 envelope.
-}
encodeGroupCommitBase64url : GroupCommit -> Maybe String
encodeGroupCommitBase64url record =
    case encodeGroupCommit record of
        Nothing ->
            Nothing

        Just body ->
            let
                wire =
                    Base64Url.encode body
            in
            if String.length wire <= groupCommitMaxB64url then
                Just wire

            else
                Nothing


{-| Decode exact raw bytes; trailing bytes reject.
-}
decodeGroupCommitBytes : List Int -> Maybe GroupCommit
decodeGroupCommitBytes raw =
    if List.length raw /= groupCommitBytes then
        Nothing

    else if List.take 6 raw /= magicBytes || Maybe.withDefault -1 (List.head (List.drop 6 raw)) /= groupCommitVersion then
        Nothing

    else
        case ( readU64be (slice 7 15 raw), readU64be (slice 15 23 raw) ) of
            ( Just prior, Just next ) ->
                let
                    record =
                        { priorEpoch = prior
                        , nextEpoch = next
                        , priorCommitHash = slice 23 55 raw
                        , commitId = slice 55 87 raw
                        , membershipDigest = slice 87 119 raw
                        , newEpochKeyCommitment = slice 119 151 raw
                        }
                in
                if validRecord record then
                    Just record

                else
                    Nothing

            _ ->
                Nothing


slice : Int -> Int -> List Int -> List Int
slice from to bytes =
    List.take (to - from) (List.drop from bytes)


{-| Decode a canonical base64url body: re-encoding must reproduce the
input exactly (rejects non-canonical spellings), then the byte decode
applies.
-}
decodeGroupCommitBase64url : String -> Maybe GroupCommit
decodeGroupCommitBase64url input =
    case Base64Url.decode input of
        Nothing ->
            Nothing

        Just raw ->
            if Base64Url.encode raw /= input then
                Nothing

            else
                decodeGroupCommitBytes raw


validAccount : String -> Bool
validAccount value =
    let
        normalized =
            String.toLower (String.trim value)

        ok c =
            Char.isAlphaNum c || c == '_' || c == '.' || c == '@' || c == '-'
    in
    not (String.isEmpty normalized)
        && String.length normalized <= 64
        && String.all ok normalized


validDevice : String -> Bool
validDevice value =
    let
        ok c =
            Char.isAlphaNum c || c == '_' || c == '.' || c == '-'
    in
    not (String.isEmpty value)
        && String.length value <= 32
        && String.all ok value


writeField : List Int -> List Int
writeField field =
    [ modBy 256 (List.length field // 256), modBy 256 (List.length field) ] ++ field


{-| Canonical context for commit hashes and outer transcript binding:
`domain || 0x00 || u16len+room || u16len+account || u16len+device ||
u64 prior || u64 next || commitId`.
-}
buildGroupCommitContext :
    { room : String
    , fromAccount : String
    , fromDevice : String
    , priorEpoch : Int
    , nextEpoch : Int
    , commitId : List Int
    }
    -> Maybe (List Int)
buildGroupCommitContext input =
    case Keyring.normalizeGroupRoom input.room of
        Nothing ->
            Nothing

        Just room ->
            if not (validAccount input.fromAccount) then
                Nothing

            else if not (validDevice input.fromDevice) then
                Nothing

            else if input.priorEpoch < 0 || input.nextEpoch < 0 then
                Nothing

            else if not (validNonZeroFixed input.commitId) then
                Nothing

            else
                let
                    fields =
                        List.map Base64Url.utf8Bytes
                            [ room
                            , String.toLower (String.trim input.fromAccount)
                            , input.fromDevice
                            ]
                in
                if List.any (\f -> List.length f > 65535) fields then
                    Nothing

                else
                    Just
                        (contextDomain
                            ++ [ 0 ]
                            ++ List.concatMap writeField fields
                            ++ writeU64be input.priorEpoch
                            ++ writeU64be input.nextEpoch
                            ++ input.commitId
                        )


{-| Exact `SHA-256(domain || 0x00 || context || body)` preimage for the
hash port. Empty contexts refuse (the oracle rejects them too).
-}
commitHashPreimage : GroupCommit -> List Int -> Maybe (List Int)
commitHashPreimage record context =
    case encodeGroupCommit record of
        Nothing ->
            Nothing

        Just body ->
            if List.isEmpty context then
                Nothing

            else
                Just (hashDomain ++ [ 0 ] ++ context ++ body)

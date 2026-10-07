module GroupEnvelope exposing
    ( GroupEnvelopeParts
    , buildGroupAad
    , groupEnvelopePrefix
    , groupEnvelopeVersion
    , groupLockedPlaceholder
    , groupMessageDisplayText
    , isGroupEnvelope
    , maxGroupCiphertextBytes
    , maxGroupEnvelopeWireBytes
    , maxGroupPlaintextBytes
    , maxRoomEpochs
    , normalizeGroupRoom
    , packGroupEnvelope
    , parseGroupEnvelope
    , validRoomEpoch
    )

{-| Era 3 C1 group-room E2EE envelope — Elm port of the pure surface of
`src/lib/e2ee/groupEnvelope.ts` plus the pure validators of
`src/lib/e2ee/groupKeyring.ts`.

Wire: `ONYXROOM1 ` ‖ b64url(version u8 ‖ keyEpoch u32be ‖ nonce12 ‖ ct‖tag)

AES-GCM binds additional authenticated data (AAD) to the normalized room
name and key epoch so ciphertext cannot be replayed across rooms or
epochs. Seal/open (WebCrypto) live behind ports; everything structural —
parse, pack, AAD bytes, fail-closed display — is pure here and covered
by vectors from `groupEnvelope.test.ts` and contract v2
`message_policy_vectors`.

-}

import Base64Url
import Bitwise


groupEnvelopePrefix : String
groupEnvelopePrefix =
    "ONYXROOM1 "


groupEnvelopeVersion : Int
groupEnvelopeVersion =
    1


{-| Exact daemon limit for the complete ASCII `ONYXROOM1 ...` body. -}
maxGroupEnvelopeWireBytes : Int
maxGroupEnvelopeWireBytes =
    4096


maxGroupPlaintextBytes : Int
maxGroupPlaintextBytes =
    3031


maxGroupCiphertextBytes : Int
maxGroupCiphertextBytes =
    maxGroupPlaintextBytes + 16


maxRoomEpochs : Int
maxRoomEpochs =
    8


maxRoomNameBytes : Int
maxRoomNameBytes =
    256


nonceBytes : Int
nonceBytes =
    12


gcmTagBytes : Int
gcmTagBytes =
    16


headerBytes : Int
headerBytes =
    5


minBodyBytes : Int
minBodyBytes =
    headerBytes + nonceBytes + gcmTagBytes


maxBodyBytes : Int
maxBodyBytes =
    headerBytes + nonceBytes + maxGroupCiphertextBytes


{-| Placeholder shown when room ciphertext cannot be opened. -}
groupLockedPlaceholder : String
groupLockedPlaceholder =
    "🔒 Encrypted room message (missing room key)"


type alias GroupEnvelopeParts =
    { version : Int
    , keyEpoch : Int
    , nonce : List Int
    , ciphertext : List Int
    }


isGroupEnvelope : String -> Bool
isGroupEnvelope text =
    String.startsWith groupEnvelopePrefix text


{-| Canonical room name for keyring lookup and AAD binding.
Trim + lowercase; reject empty and oversized names.
-}
normalizeGroupRoom : String -> Maybe String
normalizeGroupRoom room =
    let
        normalized =
            String.toLower (String.trim room)
    in
    if String.isEmpty normalized || Base64Url.utf8ByteLength normalized > maxRoomNameBytes then
        Nothing

    else
        Just normalized


{-| Epoch range. Same Elm-`Int` divergence as `GroupControl.validControlEpoch`:
wire values `2^31..2^32-1` decode to negative `Int`s and are rejected.
-}
validRoomEpoch : Int -> Bool
validRoomEpoch epoch =
    epoch >= 0


{-| Canonical AAD bytes: `ONYXROOM1|<room>|<epoch>` (ASCII domain).
Both seal and open must use the same bytes.
-}
buildGroupAad : String -> Int -> Maybe (List Int)
buildGroupAad room keyEpoch =
    case normalizeGroupRoom room of
        Nothing ->
            Nothing

        Just normalized ->
            if not (validRoomEpoch keyEpoch) then
                Nothing

            else
                Just
                    (Base64Url.utf8Bytes
                        ("ONYXROOM1|" ++ normalized ++ "|" ++ String.fromInt keyEpoch)
                    )


{-| Parse a group envelope without decrypting. Fail closed on any
structural problem so hostile room traffic never reaches WebCrypto.
-}
parseGroupEnvelope : String -> Maybe GroupEnvelopeParts
parseGroupEnvelope text =
    if not (isGroupEnvelope text) then
        Nothing

    else
        case Base64Url.decode (String.dropLeft (String.length groupEnvelopePrefix) text) of
            Nothing ->
                Nothing

            Just raw ->
                if List.length raw < minBodyBytes || List.length raw > maxBodyBytes then
                    Nothing

                else
                    let
                        version =
                            Maybe.withDefault -1 (List.head raw)
                    in
                    if version /= groupEnvelopeVersion then
                        Nothing

                    else
                        let
                            keyEpoch =
                                readU32be raw 1

                            nonce =
                                sliceBytes headerBytes (headerBytes + nonceBytes) raw

                            ciphertext =
                                List.drop (headerBytes + nonceBytes) raw
                        in
                        if List.length ciphertext < gcmTagBytes then
                            Nothing

                        else
                            Just
                                { version = version
                                , keyEpoch = keyEpoch
                                , nonce = nonce
                                , ciphertext = ciphertext
                                }


{-| Build an envelope body from already-produced AES-GCM output.
Callers own key derivation; this only packages the wire shape.
-}
packGroupEnvelope : Int -> List Int -> List Int -> Maybe String
packGroupEnvelope keyEpoch nonce ciphertext =
    if not (validRoomEpoch keyEpoch) then
        Nothing

    else if List.length nonce /= nonceBytes then
        Nothing

    else if List.length ciphertext < gcmTagBytes || List.length ciphertext > maxGroupCiphertextBytes then
        Nothing

    else
        let
            wire =
                groupEnvelopePrefix
                    ++ Base64Url.encode
                        ([ groupEnvelopeVersion ]
                            ++ writeU32be keyEpoch
                            ++ nonce
                            ++ ciphertext
                        )
        in
        if String.length wire <= maxGroupEnvelopeWireBytes then
            Just wire

        else
            Nothing


{-| Display body for a (possibly sealed) room message. Ciphertext never
leaves this helper — without attached plaintext an envelope renders the
locked placeholder.
-}
groupMessageDisplayText : String -> Maybe String -> String
groupMessageDisplayText text plaintext =
    case plaintext of
        Just opened ->
            opened

        Nothing ->
            if isGroupEnvelope text then
                groupLockedPlaceholder

            else
                text



-- byte helpers (mirrored from GroupControl for module independence)


readU32be : List Int -> Int -> Int
readU32be bytes offset =
    let
        at idx =
            Maybe.withDefault 0 (List.head (List.drop idx bytes))
    in
    Bitwise.or
        (Bitwise.shiftLeftBy 24 (at offset))
        (Bitwise.or
            (Bitwise.shiftLeftBy 16 (at (offset + 1)))
            (Bitwise.or (Bitwise.shiftLeftBy 8 (at (offset + 2))) (at (offset + 3)))
        )


writeU32be : Int -> List Int
writeU32be value =
    [ Bitwise.and 0xFF (Bitwise.shiftRightBy 24 value)
    , Bitwise.and 0xFF (Bitwise.shiftRightBy 16 value)
    , Bitwise.and 0xFF (Bitwise.shiftRightBy 8 value)
    , Bitwise.and 0xFF value
    ]


sliceBytes : Int -> Int -> List Int -> List Int
sliceBytes from to bytes =
    List.take (to - from) (List.drop from bytes)

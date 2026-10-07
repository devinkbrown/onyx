module DmCipher exposing
    ( DeviceDirectory
    , EnvelopeContent(..)
    , PeerKeyVerdict(..)
    , PinRead(..)
    , applyKeyList
    , applySingleKey
    , blankDirectory
    , boundMetadataValue
    , decodeMultiSealBodies
    , encodeMultiSealBodies
    , encodeSafetyGroups
    , envelopeBodyOffset
    , envelopePrefix
    , isDmE2eeDesignated
    , isEnvelope
    , isMultiEnvelope
    , isValidPeerPublicKey
    , lockedPlaceholder
    , maxMultiDeviceSeals
    , minBodyBytes
    , multiEnvelopePrefix
    , normalizePeerDeviceKeys
    , parseEnvelopeBody
    , peerDeviceSetStatus
    , peerKeyStatus
    , registryIdFromDigest
    , removePeer
    )

{-| Mooring DM cipher — Elm port of the pure surface in
`src/lib/e2ee/dmCipher.ts`, `keyPinning.ts` (verdicts), and the
`store.ts` device-directory fold (`ocean.dm-key(s)` via 761/766).

Pure envelope codec, key-shape validation, TOFU verdicts, safety-number
groups, and the `isDmE2eeDesignated` predicate. Everything that touches
secret bytes stays behind ports: P-256 ECDH + HKDF-SHA-256 + AES-GCM,
SHA-256/SHA-512 digests, the `onyx-keys` and `onyx-key-pins` IndexedDB
stores, and the TOFU write chain. Keys cross the Elm boundary as opaque
base64url strings, never as bytes the UI could render.

Fail-closed throughout: malformed envelopes, bad key shapes, unreadable
pin stores, and changed keys all resolve to `locked` / `unavailable` —
never to plaintext. A DM that fails to open stays
`lockedPlaceholder`; a DM that fails to seal is never sent.

-}

import Array
import Base64Url
import Bitwise
import Dict exposing (Dict)
import Json.Decode as Decode


envelopePrefix : String
envelopePrefix =
    "ONYXDM1 "


multiEnvelopePrefix : String
multiEnvelopePrefix =
    "ONYXDMN1 "


{-| Hard cap on fan-out targets so a hostile directory cannot force
unbounded work.
-}
maxMultiDeviceSeals : Int
maxMultiDeviceSeals =
    16


{-| Rendered in place of ciphertext we cannot open (wrong device, lost
key, changed key).
-}
lockedPlaceholder : String
lockedPlaceholder =
    "\u{1F512} Encrypted message (sent to another device)"


{-| Smallest possible seal body: a 12-byte nonce plus a bare
(empty-plaintext) 16-byte GCM tag.
-}
minBodyBytes : Int
minBodyBytes =
    28


sec1UncompressedBytes : Int
sec1UncompressedBytes =
    65


sec1UncompressedTag : Int
sec1UncompressedTag =
    0x04


maxMetadataValueLength : Int
maxMetadataValueLength =
    8 * 1024


{-| Structural envelope test (single or multi), mirroring `isEnvelope`.
-}
isEnvelope : String -> Bool
isEnvelope text =
    isMultiEnvelope text || String.startsWith envelopePrefix text


isMultiEnvelope : String -> Bool
isMultiEnvelope text =
    String.startsWith multiEnvelopePrefix text


{-| Body offset after a recognized envelope prefix, or -1. Multi is
checked first so its longer prefix wins, exactly like the oracle.
-}
envelopeBodyOffset : String -> Int
envelopeBodyOffset text =
    if isMultiEnvelope text then
        String.length multiEnvelopePrefix

    else if String.startsWith envelopePrefix text then
        String.length envelopePrefix

    else
        -1


{-| Structural fail-closed validation of a peer's published device key
BEFORE it ever reaches crypto: strict unpadded base64url decoding to a
65-byte uncompressed SEC1 point (leading 0x04). This does NOT prove the
point is on the curve — importKey/deriveBits does that ports-side — and
says nothing about WHOSE key it is (the TOFU pin layer's job).
-}
isValidPeerPublicKey : String -> Bool
isValidPeerPublicKey peerPublicB64 =
    case Base64Url.decode peerPublicB64 of
        Nothing ->
            False

        Just raw ->
            List.length raw == sec1UncompressedBytes
                && List.head raw == Just sec1UncompressedTag


{-| Deduplicate + structurally validate peer device public keys for
fan-out. Trims entries, drops empties/dupes/invalid shapes, caps at
`maxMultiDeviceSeals`.
-}
normalizePeerDeviceKeys : List String -> List String
normalizePeerDeviceKeys keys =
    List.foldl
        (\raw acc ->
            let
                key =
                    String.trim raw
            in
            if String.isEmpty key || List.member key acc || not (isValidPeerPublicKey key) then
                acc

            else if List.length acc >= maxMultiDeviceSeals then
                acc

            else
                acc ++ [ key ]
        )
        []
        keys



-- ── Multi-seal body codec ────────────────────────────────────────────


{-| Pack seal bodies as `u16be count ‖ (u16be len ‖ body)*`. Each body
must hold at least `minBodyBytes`; lengths ride a u16 so bodies over
0xffff are refused, mirroring the oracle's `body.length > 0xffff`
guard.
-}
encodeMultiSealBodies : List (List Int) -> Maybe (List Int)
encodeMultiSealBodies bodies =
    if List.isEmpty bodies || List.length bodies > maxMultiDeviceSeals then
        Nothing

    else if List.any (\b -> List.length b < minBodyBytes || List.length b > 0xFFFF) bodies then
        Nothing

    else
        Just
            (u16be (List.length bodies)
                ++ List.concatMap (\b -> u16be (List.length b) ++ List.map (Bitwise.and 0xFF) b) bodies
            )


u16be : Int -> List Int
u16be value =
    [ Bitwise.and 0xFF (value // 256), Bitwise.and 0xFF value ]


{-| Unpack `u16be count ‖ (u16be len ‖ body)*`. Rejects a zero or
over-cap count, short/truncated bodies, and trailing garbage so a
smuggled payload cannot hide after valid seals.
-}
decodeMultiSealBodies : List Int -> Maybe (List (List Int))
decodeMultiSealBodies packed =
    let
        arr =
            Array.fromList packed
    in
    case ( Array.get 0 arr, Array.get 1 arr ) of
        ( Just hi, Just lo ) ->
            let
                count =
                    hi * 256 + lo
            in
            if count == 0 || count > maxMultiDeviceSeals then
                Nothing

            else
                decodeBodies arr count 2 []

        _ ->
            Nothing


decodeBodies : Array.Array Int -> Int -> Int -> List (List Int) -> Maybe (List (List Int))
decodeBodies arr remaining offset acc =
    if remaining == 0 then
        if offset == Array.length arr then
            Just (List.reverse acc)

        else
            Nothing

    else
        case ( Array.get offset arr, Array.get (offset + 1) arr ) of
            ( Just hi, Just lo ) ->
                let
                    len =
                        hi * 256 + lo

                    start =
                        offset + 2
                in
                if len < minBodyBytes || start + len > Array.length arr then
                    Nothing

                else
                    decodeBodies arr (remaining - 1) (start + len) (Array.toList (Array.slice start (start + len) arr) :: acc)

            _ ->
                Nothing



-- ── Envelope pack / parse (structure only; crypto is ports-side) ────


type EnvelopeContent
    = SingleBody (List Int)
    | MultiBodies (List (List Int))


{-| Parse an envelope's body bytes with full structural validation.
`Nothing` on a missing prefix, bad base64url, a short single body, or
a malformed multi pack.
-}
parseEnvelopeBody : String -> Maybe EnvelopeContent
parseEnvelopeBody envelope =
    if isMultiEnvelope envelope then
        case Base64Url.decode (String.dropLeft (String.length multiEnvelopePrefix) envelope) of
            Nothing ->
                Nothing

            Just packed ->
                Maybe.map MultiBodies (decodeMultiSealBodies packed)

    else if String.startsWith envelopePrefix envelope then
        case Base64Url.decode (String.dropLeft (String.length envelopePrefix) envelope) of
            Nothing ->
                Nothing

            Just body ->
                if List.length body < minBodyBytes then
                    Nothing

                else
                    Just (SingleBody body)

    else
        Nothing



-- ── TOFU pin verdicts (store reads are ports-side) ───────────────────


{-| What the pin store reported for an account's trust bucket.
`PinUnreadable` means the store could not be read at all — callers
MUST fail closed.
-}
type PinRead
    = PinUnreadable
    | PinAbsent
    | PinRaw String


type PeerKeyVerdict
    = FirstUse
    | Unchanged
    | Changed
    | Unreadable


multiPinPrefix : String
multiPinPrefix =
    "{\"v\":1,\"k\":"


{-| Parse a stored pin: a legacy single-key string, or a versioned
`{"v":1,"k":[...]}` multi-pin blob. Corrupt blobs (and non-key
garbage) parse to `Nothing` — the caller fails closed rather than
re-TOFUing, exactly like the oracle.
-}
parsePinnedKeys : String -> Maybe (List String)
parsePinnedKeys raw =
    if isValidPeerPublicKey raw then
        Just [ raw ]

    else if not (String.startsWith multiPinPrefix raw) && not (String.startsWith "{" raw) then
        Nothing

    else
        case Decode.decodeString multiPinDecoder raw of
            Err _ ->
                Nothing

            Ok keys ->
                let
                    normalized =
                        normalizePeerDeviceKeys keys
                in
                if List.isEmpty normalized then
                    Nothing

                else
                    Just normalized


multiPinDecoder : Decode.Decoder (List String)
multiPinDecoder =
    Decode.map2
        (\version keys ->
            if version == 1 then
                keys

            else
                []
        )
        (Decode.field "v" Decode.int)
        -- Non-string entries decode to "" and fall out in normalization,
        -- mirroring the oracle's `typeof entry === 'string'` filter.
        (Decode.field "k" (Decode.list (Decode.oneOf [ Decode.string, Decode.null "" ])))


{-| Trust verdict for one presented key against the stored pin. Pure
read: this never establishes trust — pinning happens explicitly in
the gated seal/open paths ports-side.
-}
peerKeyStatus : PinRead -> String -> PeerKeyVerdict
peerKeyStatus stored presentedKey =
    case stored of
        PinUnreadable ->
            Unreadable

        PinAbsent ->
            FirstUse

        PinRaw raw ->
            case parsePinnedKeys raw of
                Nothing ->
                    -- Corrupt multi-pin / non-key garbage: fail closed
                    -- rather than re-TOFU.
                    if raw == presentedKey then
                        Unchanged

                    else
                        Changed

                Just pinned ->
                    if List.member presentedKey pinned then
                        Unchanged

                    else
                        Changed


{-| Trust verdict for a whole device-key set. First-use when no pin
exists; unchanged when every presented key is already pinned;
changed when any presented key is new after a pin exists.
-}
peerDeviceSetStatus : PinRead -> List String -> PeerKeyVerdict
peerDeviceSetStatus stored presentedKeys =
    let
        keys =
            normalizePeerDeviceKeys presentedKeys
    in
    if List.isEmpty keys then
        Unreadable

    else
        case stored of
            PinUnreadable ->
                Unreadable

            PinAbsent ->
                FirstUse

            PinRaw raw ->
                case parsePinnedKeys raw of
                    Nothing ->
                        Changed

                    Just pinned ->
                        if List.isEmpty pinned then
                            Changed

                        else if List.all (\key -> List.member key pinned) keys then
                            Unchanged

                        else
                            Changed



-- ── Safety number (digest is ports-side; grouping is pure) ──────────


{-| Turn `count` 5-byte windows of digest bytes into zero-padded
5-digit decimal groups (libsignal's NumericFingerprintGenerator
encoding: a 40-bit big-endian window mod 100000). `Nothing` when the
digest holds fewer than `count * 5` bytes. The 60-digit conversation
number uses count 12 over a SHA-512 digest.
-}
encodeSafetyGroups : List Int -> Int -> Maybe String
encodeSafetyGroups bytes count =
    if count <= 0 || List.length bytes < count * 5 then
        Nothing

    else
        Just
            (List.range 0 (count - 1)
                |> List.map (\g -> groupAt bytes (g * 5))
                |> String.join " "
            )


groupAt : List Int -> Int -> String
groupAt bytes offset =
    let
        window =
            List.drop offset bytes |> List.take 5

        value =
            List.foldl (\b acc -> acc * 256 + Bitwise.and 0xFF b) 0 window
    in
    String.padLeft 5 '0' (String.fromInt (modBy 100000 value))


{-| Stable, non-secret registry id for this browser's E2EE key, built
from a 32-byte SHA-256 digest of the public point (the digest itself
is computed ports-side): `web-` plus the first 20 base64url chars.
Stable across reloads, distinct per device, valid for the wire's
32-character id bound, reveals no private material.
-}
registryIdFromDigest : List Int -> Maybe String
registryIdFromDigest digest =
    if List.length digest /= 32 then
        Nothing

    else
        Just ("web-" ++ String.left 20 (Base64Url.encode digest))



-- ── Device directory (peerDmKeys / peerDmDeviceKeys) ─────────────────


{-| The peer device-key directory: lowercase nick → primary key, plus
nick → full multi-device key set. Mirrors the oracle's `peerDmKeys` /
`peerDmDeviceKeys` maps; the send path seals to the full set.
-}
type alias DeviceDirectory =
    { primary : Dict String String
    , devices : Dict String (List String)
    }


blankDirectory : DeviceDirectory
blankDirectory =
    { primary = Dict.empty, devices = Dict.empty }


{-| Fold one `ocean.dm-key` value: a valid key becomes primary and
merges into the device set; anything else deletes the primary (the
merged device set is left alone, exactly like the oracle).
-}
applySingleKey : String -> String -> DeviceDirectory -> DeviceDirectory
applySingleKey nickKey value directory =
    if isValidPeerPublicKey value then
        { primary = Dict.insert nickKey value directory.primary
        , devices =
            Dict.insert nickKey
                (normalizePeerDeviceKeys (Maybe.withDefault [] (Dict.get nickKey directory.devices) ++ [ value ]))
                directory.devices
        }

    else
        { directory | primary = Dict.remove nickKey directory.primary }


{-| Fold one `ocean.dm-keys` value (comma/whitespace-separated): a
nonempty normalized set replaces the device list and backfills the
primary when absent; an empty set deletes the device list (the
primary is left alone, exactly like the oracle).
-}
applyKeyList : String -> List String -> DeviceDirectory -> DeviceDirectory
applyKeyList nickKey values directory =
    let
        normalized =
            normalizePeerDeviceKeys values
    in
    if List.isEmpty normalized then
        { directory | devices = Dict.remove nickKey directory.devices }

    else
        { devices = Dict.insert nickKey normalized directory.devices
        , primary =
            if Dict.member nickKey directory.primary then
                directory.primary

            else
                case List.head normalized of
                    Just first ->
                        Dict.insert nickKey first directory.primary

                    Nothing ->
                        directory.primary
        }


{-| Forget a peer entirely (both maps). -}
removePeer : String -> DeviceDirectory -> DeviceDirectory
removePeer nickKey directory =
    { primary = Dict.remove nickKey directory.primary
    , devices = Dict.remove nickKey directory.devices
    }


{-| Bound a METADATA value the oracle's way: slice to 8K chars, then
trim a trailing lead surrogate. (Elm `String.left` counts code points
rather than UTF-16 units, so over-astral tails stay intact — the
stricter direction.)
-}
boundMetadataValue : String -> String
boundMetadataValue value =
    let
        bounded =
            String.left maxMetadataValueLength value
    in
    case String.uncons (String.reverse bounded) of
        Just ( last, rest ) ->
            let
                code =
                    Char.toCode last
            in
            if code >= 0xD800 && code <= 0xDBFF then
                String.reverse rest

            else
                bounded

        Nothing ->
            bounded



-- ── E2EE designation ─────────────────────────────────────────────────


{-| Inputs to the designation predicate. `directoryDevices` is the raw
stored device list (its mere nonemptiness designates, even when
corrupt — fail closed). `hasEncryptedBoundary` covers conversation
history holding an envelope. The vault-DM-search-privacy clause lives
ports-side with the vault.
-}
type alias DesignationInput =
    { chantypes : String
    , keyChanged : Bool
    , hasPrimaryKey : Bool
    , directoryDevices : List String
    , hasEncryptedBoundary : Bool
    }


{-| True when this DM is designated for E2EE and must never fall
through to plaintext send, offline outbox persistence, or server
search. Independent of any preference: a published legacy key, a
nonempty directory (even corrupt), a key-change flag, or encrypted
history all designate. Channels never designate.
-}
isDmE2eeDesignated : DesignationInput -> String -> Bool
isDmE2eeDesignated input peer =
    let
        trimmed =
            String.trim peer
    in
    if String.isEmpty trimmed then
        False

    else
        case String.uncons trimmed of
            Nothing ->
                False

            Just ( first, _ ) ->
                if String.contains (String.fromChar first) input.chantypes then
                    False

                else if input.keyChanged then
                    True

                else if input.hasPrimaryKey then
                    True

                else if not (List.isEmpty input.directoryDevices) then
                    True

                else
                    input.hasEncryptedBoundary

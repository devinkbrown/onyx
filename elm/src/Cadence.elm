module Cadence exposing
    ( CadenceCodec(..)
    , CadenceFrame
    , ReplayGuard
    , clearGuard
    , codecToByte
    , commitIv
    , decodeFrame
    , defaultMaxSenders
    , defaultWindowBits
    , encodeFrame
    , headerBytes
    , macTagBytes
    , makeGuard
    , mayAcceptIv
    , mediaBandFloor
    , minFrameBytes
    , senderCount
    )

{-| Cadence media datagrams — Elm port of `cadenceFrame.ts` (wire
format `cadence_frame.zig`) and `replayWindow.ts` (bounded
anti-replay guard for media E2EE IVs).

Bytes are `List Int` (0–255); out-of-range bytes fail closed. The
u64 media-clock timestamp rides a Float (exact below 2^53, mirroring
the oracle's `Number` carriage); split/assemble uses exact
integer arithmetic (`modBy` + small-quotient `(//)`, never
`truncate` or wide shifts — see the 32-bit kernel note in
`COVERAGE.md`). Replay bitmaps become `Set Int` offset sets, which
is semantically identical to the oracle bitmask (bit `i` set ⟺
offset `i` committed) without needing BigInt.

Pure: crypto (MAC tag append/check, encrypt/decrypt) and the binary
socket stay behind ports; this module owns framing, validation,
and replay bookkeeping.
-}

import Bitwise
import Set exposing (Set)


{-| Frame header size (mirrors `CADENCE_HEADER_BYTES`). -}
headerBytes : Int
headerBytes =
    19


{-| Minimum wire bytes: 4-byte length + header (mirrors
`CADENCE_MIN_FRAME_BYTES`). -}
minFrameBytes : Int
minFrameBytes =
    23


{-| Control bands are `[0, 64)`; media frames use `band >= 64`. -}
mediaBandFloor : Int
mediaBandFloor =
    64


{-| Trailing MAC tag the server forwards verbatim (mirrors the
`macTagBytes = 16` decode default). -}
macTagBytes : Int
macTagBytes =
    16


{-| Sliding-window width (mirrors `REPLAY_WINDOW_BITS`). -}
defaultWindowBits : Int
defaultWindowBits =
    1024


{-| Sender-prefix cap (mirrors `REPLAY_MAX_SENDERS`). -}
defaultMaxSenders : Int
defaultMaxSenders =
    256


{-| Wire codec tags (mirrors `CadenceCodec`: raw/cadencevox/cadencevis). -}
type CadenceCodec
    = CodecRaw
    | CodecVox
    | CodecVis


codecToByte : CadenceCodec -> Int
codecToByte codec =
    case codec of
        CodecRaw ->
            0

        CodecVox ->
            1

        CodecVis ->
            2


byteToCodec : Int -> Maybe CadenceCodec
byteToCodec byte =
    case byte of
        0 ->
            Just CodecRaw

        1 ->
            Just CodecVox

        2 ->
            Just CodecVis

        _ ->
            Nothing


type alias CadenceFrame =
    { bandId : Int
    , streamId : Int
    , sequence : Int
    , timestamp : Float
    , keyframe : Bool
    , codec : CadenceCodec
    , payload : List Int
    }


isByte : Int -> Bool
isByte b =
    b >= 0 && b <= 255


{-| Wrapping u32 coerce (mirrors `>>> 0`). -}
wrapU32 : Int -> Int
wrapU32 v =
    modBy 4294967296 v


u32LeBytes : Int -> List Int
u32LeBytes w =
    List.map
        (\shift -> Bitwise.and 255 (Bitwise.shiftRightZfBy shift w))
        [ 0, 8, 16, 24 ]


u32Le : List Int -> Maybe Int
u32Le bytes =
    case bytes of
        [ b0, b1, b2, b3 ] ->
            if List.all isByte bytes then
                Just (b0 + b1 * 256 + b2 * 65536 + b3 * 16777216)

            else
                Nothing

        _ ->
            Nothing


{-| Exact u64 split (`hi * 2^32 + lo`): `modBy` is full-precision
and the quotient stays below 2^21, so neither the 32-bit kernel
traps nor float rounding can skew it. -}
splitU64 : Int -> { hi : Int, lo : Int }
splitU64 v =
    let
        lo =
            modBy 4294967296 v
    in
    { hi = (v - lo) // 4294967296, lo = lo }


u64LeBytes : Int -> List Int
u64LeBytes v =
    let
        parts =
            splitU64 v
    in
    u32LeBytes parts.lo ++ u32LeBytes parts.hi


u64Le : List Int -> Maybe Float
u64Le bytes =
    case ( u32Le (List.take 4 bytes), u32Le (List.drop 4 bytes) ) of
        ( Just lo, Just hi ) ->
            -- `hi * 2^32` is an exact power-of-two scale and the single
            -- addition is correctly rounded — identical to `Number(u64)`.
            Just (toFloat hi * 4294967296 + toFloat lo)

        _ ->
            Nothing


validTimestamp : Float -> Maybe Int
validTimestamp t =
    -- Integer-valued, in `[0, 2^53)`: `floor` of an exactly
    -- represented integer is itself.
    if t >= 0 && t < 9007199254740992 && t == toFloat (floor t) then
        Just (floor t)

    else
        Nothing


{-| Encode a frame (mirrors `encodeCadenceFrame`): `Nothing` on a
control band id, a non-integer/out-of-range timestamp, or
out-of-range payload bytes (the oracle throws; Elm fails closed).
-}
encodeFrame : CadenceFrame -> Maybe (List Int)
encodeFrame frame =
    if frame.bandId < mediaBandFloor || frame.bandId > 255 then
        Nothing

    else if not (List.all isByte frame.payload) then
        Nothing

    else
        case validTimestamp frame.timestamp of
            Nothing ->
                Nothing

            Just stamp ->
                Just
                    (u32LeBytes (List.length frame.payload)
                        ++ [ frame.bandId ]
                        ++ u32LeBytes (wrapU32 frame.streamId)
                        ++ u32LeBytes (wrapU32 frame.sequence)
                        ++ u64LeBytes stamp
                        ++ [ if frame.keyframe then 1 else 0
                           , codecToByte frame.codec
                           ]
                        ++ frame.payload
                    )


{-| Decode a frame prefix, ignoring one optional trailing MAC tag
(mirrors `decodeCadenceFrame`): `Nothing` when too short, when the
declared payload overruns (absent the single tag allowance), on a
control band, or on an unknown codec.
-}
decodeFrame : List Int -> Maybe CadenceFrame
decodeFrame bytes =
    if not (List.all isByte bytes) || List.length bytes < minFrameBytes then
        Nothing

    else
        case u32Le (List.take 4 bytes) of
            Nothing ->
                Nothing

            Just payloadLen ->
                let
                    declaredTotal =
                        minFrameBytes + payloadLen

                    total =
                        List.length bytes
                in
                if total /= declaredTotal && total /= declaredTotal + macTagBytes then
                    Nothing

                else
                    decodeHeader bytes payloadLen


decodeHeader : List Int -> Int -> Maybe CadenceFrame
decodeHeader bytes payloadLen =
    let
        rest =
            List.drop 4 bytes
    in
    case rest of
        bandId :: s0 :: s1 :: s2 :: s3 :: q0 :: q1 :: q2 :: q3 :: t0 :: t1 :: t2 :: t3 :: t4 :: t5 :: t6 :: t7 :: flags :: codecByte :: tail ->
            if bandId < mediaBandFloor then
                Nothing

            else
                case ( u32Le [ s0, s1, s2, s3 ], u32Le [ q0, q1, q2, q3 ] ) of
                    ( Just streamId, Just sequence ) ->
                        case ( u64Le [ t0, t1, t2, t3, t4, t5, t6, t7 ], byteToCodec codecByte ) of
                            ( Just timestamp, Just codec ) ->
                                Just
                                    { bandId = bandId
                                    , streamId = streamId
                                    , sequence = sequence
                                    , timestamp = timestamp
                                    , keyframe = Bitwise.and 1 flags /= 0
                                    , codec = codec
                                    , payload = List.take payloadLen tail
                                    }

                            _ ->
                                Nothing

                    _ ->
                        Nothing

        _ ->
            Nothing


type alias SenderState =
    { highest : Int
    , seen : Set Int
    }


{-| Bounded anti-replay guard (mirrors `ReplayGuard`): per
sender-prefix `{ highest, seen }` with MRU-first sender order. The
`seen` offset set is the oracle bitmap (`diff` committed ⟺ bit
`diff` set).
-}
type alias ReplayGuard =
    { windowBits : Int
    , maxSenders : Int
    , senders : List ( String, SenderState )
    }


{-| Build a guard (`Nothing` on non-positive dimensions, mirroring
the constructor throws). -}
makeGuard : Int -> Int -> Maybe ReplayGuard
makeGuard windowBits maxSenders =
    if windowBits < 1 || maxSenders < 1 then
        Nothing

    else
        Just { windowBits = windowBits, maxSenders = maxSenders, senders = [] }


{-| Forget all sender state (mirrors `clear`). -}
clearGuard : ReplayGuard -> ReplayGuard
clearGuard guard =
    { guard | senders = [] }


{-| Distinct sender-prefixes tracked (mirrors `senderCount`). -}
senderCount : ReplayGuard -> Int
senderCount guard =
    List.length guard.senders


byteHex : Int -> String
byteHex b =
    let
        hex =
            "0123456789abcdef"

        hi =
            b // 16

        lo =
            modBy 16 b
    in
    String.slice hi (hi + 1) hex ++ String.slice lo (lo + 1) hex


{-| Split a 12-byte IV into hex prefix + BE counter (mirrors
`splitIv`; `Nothing` on mis-sized input where the oracle throws).
-}
splitIv : List Int -> Maybe { prefix : String, counter : Int }
splitIv iv =
    if List.length iv /= 12 || not (List.all isByte iv) then
        Nothing

    else
        case iv of
            p0 :: p1 :: p2 :: p3 :: p4 :: p5 :: p6 :: p7 :: c0 :: c1 :: c2 :: c3 :: [] ->
                Just
                    { prefix = String.concat (List.map byteHex [ p0, p1, p2, p3, p4, p5, p6, p7 ])
                    , counter = c0 * 16777216 + c1 * 65536 + c2 * 256 + c3
                    }

            _ ->
                Nothing


findSender : String -> List ( String, SenderState ) -> Maybe SenderState
findSender prefix senders =
    case senders of
        [] ->
            Nothing

        ( key, state ) :: rest ->
            if key == prefix then
                Just state

            else
                findSender prefix rest


touchSender : String -> SenderState -> ReplayGuard -> ReplayGuard
touchSender prefix state guard =
    let
        others =
            List.filter (\( key, _ ) -> key /= prefix) guard.senders
    in
    { guard | senders = List.take guard.maxSenders (( prefix, state ) :: others) }


{-| Pure predicate: would this IV be accepted right now, without
mutating state (mirrors `mayAccept`). Mis-sized IVs read as
rejected — fail closed.
-}
mayAcceptIv : List Int -> ReplayGuard -> Bool
mayAcceptIv iv guard =
    case splitIv iv of
        Nothing ->
            False

        Just { prefix, counter } ->
            case findSender prefix guard.senders of
                Nothing ->
                    True

                Just state ->
                    if counter > state.highest then
                        True

                    else
                        let
                            diff =
                                state.highest - counter
                        in
                        if diff >= guard.windowBits then
                            False

                        else
                            not (Set.member diff state.seen)


{-| Record an IV as seen — call only after successful
authentication, mirroring `commit` (idempotent on repeats,
ignores out-of-window counters, MRU-bumps on record).
-}
commitIv : List Int -> ReplayGuard -> ReplayGuard
commitIv iv guard =
    case splitIv iv of
        Nothing ->
            guard

        Just { prefix, counter } ->
            case findSender prefix guard.senders of
                Nothing ->
                    touchSender prefix { highest = counter, seen = Set.singleton 0 } guard

                Just state ->
                    if counter > state.highest then
                        let
                            gap =
                                counter - state.highest

                            shifted =
                                if gap >= guard.windowBits then
                                    Set.empty

                                else
                                    Set.filter (\d -> d + gap < guard.windowBits)
                                        (Set.map (\d -> d + gap) state.seen)
                        in
                        touchSender prefix { highest = counter, seen = Set.insert 0 shifted } guard

                    else
                        let
                            diff =
                                state.highest - counter
                        in
                        if diff >= guard.windowBits then
                            guard

                        else
                            touchSender prefix { highest = state.highest, seen = Set.insert diff state.seen } guard

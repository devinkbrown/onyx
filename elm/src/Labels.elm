module Labels exposing
    ( isValidLabel
    , maxLabelBytes
    , maxPendingLabeledSends
    , nextClientLabel
    )

{-| IRCv3 `labeled-response` client helpers — Elm port of
`src/lib/irc/labels.ts`.

Opaque `@label=` values (≤64 bytes) correlate an outbound command with
its logical server reply so optimistic rows can be replaced with the
authoritative msgid / error.

Purity note: minting needs time + a counter. The TypeScript module hides
both (`Date.now()` + module counter); the Elm port takes `( nowMs,
counter )` explicitly so mints are deterministic and testable. Callers
thread the counter through the model; the 24-bit wrap matches the
oracle.
-}

import Base64Url


{-| IRCv3 labeled-response: label value MUST NOT exceed 64 bytes (UTF-8). -}
maxLabelBytes : Int
maxLabelBytes =
    64


{-| Bound in-flight optimistic / outbox correlations. -}
maxPendingLabeledSends : Int
maxPendingLabeledSends =
    128


{-| Mint a fresh opaque label. `o` + base36 time + base36 counter is pure
ASCII and stays far under the byte bound; the clamp mirrors the
oracle's belt-and-braces truncation.
-}
nextClientLabel : Int -> Int -> String
nextClientLabel nowMs counter =
    String.left maxLabelBytes
        ("o" ++ toBase36 nowMs ++ toBase36 (modBy 0xFFFFFF counter))


toBase36 : Int -> String
toBase36 n =
    if n <= 0 then
        "0"

    else
        String.fromList (List.reverse (base36Digits (toFloat n) []))


{-| Float-domain division: `(//)` and `truncate` wrap quotients at 32
bits (`| 0`), which corrupts millisecond timestamps — `floor` and `%`
keep full double precision.
-}
base36Digits : Float -> List Char -> List Char
base36Digits n acc =
    if n <= 0 then
        acc

    else
        let
            q =
                toFloat (floor (n / 36))

            d =
                floor (n - q * 36)
        in
        base36Digits q (base36Char d :: acc)


base36Char : Int -> Char
base36Char d =
    if d < 10 then
        Char.fromCode (0x30 + d)

    else
        Char.fromCode (0x61 + d - 10)


{-| Legal non-empty label value (≤64 UTF-8 bytes, no spaces / C0
controls / DEL). Used both to mint-check and to refuse untrusted
inbound `@label=` values that could never match our own mints.
-}
isValidLabel : String -> Bool
isValidLabel value =
    if String.isEmpty value then
        False

    else if Base64Url.utf8ByteLength value > maxLabelBytes then
        False

    else
        not (List.any isLabelBad (String.toList value))


isLabelBad : Char -> Bool
isLabelBad c =
    let
        code =
            Char.toCode c
    in
    code <= 0x20 || code == 0x7F

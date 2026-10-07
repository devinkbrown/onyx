module Base64Url exposing
    ( decode
    , encode
    , utf8ByteLength
    , utf8Bytes
    )

{-| Canonical unpadded base64url over byte lists — Elm port of the
`toB64url` / `fromB64url` helpers in `src/lib/e2ee/dmCipher.ts`.

Strict + fail-closed like the TypeScript oracle: the wire alphabet is
`[A-Za-z0-9_-]` with NO padding, so any `+`, `/`, `=` or out-of-alphabet
character — or an impossible `length % 4 == 1` — decodes to `Nothing`
rather than silently producing wrong bytes. Callers that need canonical
rejection (E2EEGROUP payloads, OGC1 envelopes) additionally check
`encode (decode w) == w`.

Bytes are `List Int` in the range 0–255. `utf8Bytes` / `utf8ByteLength`
mirror `TextEncoder` (lone surrogates become U+FFFD) because Elm exposes
no UTF-8 primitive; byte-length guards (`validChannel`, room names) must
use these, never `String.length`.

-}

import Bitwise


{-| Encode bytes as unpadded base64url. Out-of-range inputs are masked to
a byte (`Bitwise.and 0xFF`) so encoding never fails.
-}
encode : List Int -> String
encode bytes =
    encodeGroups (List.map (Bitwise.and 0xFF) bytes)


encodeGroups : List Int -> String
encodeGroups bytes =
    case bytes of
        [] ->
            ""

        [ b0 ] ->
            sextetsToString [ Bitwise.shiftRightBy 2 b0, Bitwise.shiftLeftBy 4 (Bitwise.and 0x03 b0) ]

        [ b0, b1 ] ->
            sextetsToString
                [ Bitwise.shiftRightBy 2 b0
                , Bitwise.or (Bitwise.shiftLeftBy 4 (Bitwise.and 0x03 b0)) (Bitwise.shiftRightBy 4 b1)
                , Bitwise.shiftLeftBy 2 (Bitwise.and 0x0F b1)
                ]

        b0 :: b1 :: b2 :: rest ->
            sextetsToString
                [ Bitwise.shiftRightBy 2 b0
                , Bitwise.or (Bitwise.shiftLeftBy 4 (Bitwise.and 0x03 b0)) (Bitwise.shiftRightBy 4 b1)
                , Bitwise.or (Bitwise.shiftLeftBy 2 (Bitwise.and 0x0F b1)) (Bitwise.shiftRightBy 6 b2)
                , Bitwise.and 0x3F b2
                ]
                ++ encodeGroups rest


sextetsToString : List Int -> String
sextetsToString sextets =
    sextets
        |> List.map (\s -> String.fromChar (Char.fromCode (sextetChar (Bitwise.and 0x3F s))))
        |> String.concat


sextetChar : Int -> Int
sextetChar s =
    if s < 26 then
        0x41 + s

    else if s < 52 then
        0x61 + (s - 26)

    else if s < 62 then
        0x30 + (s - 52)

    else if s == 62 then
        0x2D

    else
        0x5F


{-| Decode canonical base64url. `Nothing` on alphabet drift, padding, or
an impossible length — mirroring `fromB64url` (which additionally lets
`atob` throw on the same shapes). Like the oracle, trailing-bit content
of short final groups is NOT validated here; canonical callers compare
`encode decoded == input`.
-}
decode : String -> Maybe (List Int)
decode text =
    if String.isEmpty text then
        -- The dmCipher alphabet (`*`) admits empty; emptiness itself is
        -- rejected by each wire validator (payload, envelope, OGC1).
        Just []

    else if modBy 4 (String.length text) == 1 then
        Nothing

    else
        text
            |> String.toList
            |> List.map sextetValue
            |> combineSextets


sextetValue : Char -> Maybe Int
sextetValue c =
    let
        code =
            Char.toCode c
    in
    if code >= 0x41 && code <= 0x5A then
        Just (code - 0x41)

    else if code >= 0x61 && code <= 0x7A then
        Just (26 + code - 0x61)

    else if code >= 0x30 && code <= 0x39 then
        Just (52 + code - 0x30)

    else if code == 0x2D then
        Just 62

    else if code == 0x5F then
        Just 63

    else
        Nothing


combineSextets : List (Maybe Int) -> Maybe (List Int)
combineSextets vals =
    case vals of
        [] ->
            Just []

        [ _ ] ->
            -- Unreachable: length % 4 == 1 is rejected above, so a lone
            -- sextet can never start a group. Kept total for the compiler.
            Nothing

        [ m0, m1 ] ->
            Maybe.map2
                (\s0 s1 ->
                    [ Bitwise.or (Bitwise.shiftLeftBy 2 s0) (Bitwise.shiftRightBy 4 s1) ]
                )
                m0
                m1

        [ m0, m1, m2 ] ->
            Maybe.map3
                (\s0 s1 s2 ->
                    [ Bitwise.or (Bitwise.shiftLeftBy 2 s0) (Bitwise.shiftRightBy 4 s1)
                    , Bitwise.or (Bitwise.shiftLeftBy 4 (Bitwise.and 0x0F s1)) (Bitwise.shiftRightBy 2 s2)
                    ]
                )
                m0
                m1
                m2

        m0 :: m1 :: m2 :: m3 :: rest ->
            Maybe.map4
                (\s0 s1 s2 s3 ->
                    [ Bitwise.or (Bitwise.shiftLeftBy 2 s0) (Bitwise.shiftRightBy 4 s1)
                    , Bitwise.or (Bitwise.shiftLeftBy 4 (Bitwise.and 0x0F s1)) (Bitwise.shiftRightBy 2 s2)
                    , Bitwise.or (Bitwise.shiftLeftBy 6 (Bitwise.and 0x03 s2)) s3
                    ]
                )
                m0
                m1
                m2
                m3
                |> Maybe.andThen
                    (\first ->
                        Maybe.map (\tail -> first ++ tail) (combineSextets rest)
                    )


{-| UTF-8 byte length of a string (mirrors `TextEncoder().encode(s).length`).
-}
utf8ByteLength : String -> Int
utf8ByteLength text =
    List.length (utf8Bytes text)


{-| UTF-8 encode a string to bytes. Surrogate pairs combine to astral
code points; lone surrogates become U+FFFD, exactly like `TextEncoder`.
-}
utf8Bytes : String -> List Int
utf8Bytes text =
    text
        |> String.toList
        |> List.map Char.toCode
        |> combineSurrogates
        |> List.concatMap encodeCodePoint


combineSurrogates : List Int -> List Int
combineSurrogates units =
    List.reverse (combineSurrogatesGo units [])


combineSurrogatesGo : List Int -> List Int -> List Int
combineSurrogatesGo units acc =
    case units of
        [] ->
            acc

        h :: rest ->
            if h >= 0xD800 && h <= 0xDBFF then
                case rest of
                    l :: tail ->
                        if l >= 0xDC00 && l <= 0xDFFF then
                            combineSurrogatesGo tail ((0x10000 + Bitwise.shiftLeftBy 10 (h - 0xD800) + (l - 0xDC00)) :: acc)

                        else
                            combineSurrogatesGo rest (0xFFFD :: acc)

                    [] ->
                        0xFFFD :: acc

            else if h >= 0xDC00 && h <= 0xDFFF then
                combineSurrogatesGo rest (0xFFFD :: acc)

            else
                combineSurrogatesGo rest (h :: acc)


encodeCodePoint : Int -> List Int
encodeCodePoint cp =
    if cp < 0x80 then
        [ cp ]

    else if cp < 0x800 then
        [ Bitwise.or 0xC0 (Bitwise.shiftRightBy 6 cp)
        , Bitwise.or 0x80 (Bitwise.and 0x3F cp)
        ]

    else if cp < 0x10000 then
        [ Bitwise.or 0xE0 (Bitwise.shiftRightBy 12 cp)
        , Bitwise.or 0x80 (Bitwise.and 0x3F (Bitwise.shiftRightBy 6 cp))
        , Bitwise.or 0x80 (Bitwise.and 0x3F cp)
        ]

    else
        [ Bitwise.or 0xF0 (Bitwise.shiftRightBy 18 cp)
        , Bitwise.or 0x80 (Bitwise.and 0x3F (Bitwise.shiftRightBy 12 cp))
        , Bitwise.or 0x80 (Bitwise.and 0x3F (Bitwise.shiftRightBy 6 cp))
        , Bitwise.or 0x80 (Bitwise.and 0x3F cp)
        ]

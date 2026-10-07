module LabelsTest exposing (suite)

{-| Vectors ported from `src/lib/irc/labels.test.ts`. Minting takes
`( nowMs, counter )` explicitly instead of hiding `Date.now()` plus a
module counter, so uniqueness tests thread the counter by hand.
-}

import Base64Url
import Expect
import Labels exposing (..)
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "Labels"
        [ test "mints unique opaque labels within the 64-byte bound" <|
            \_ ->
                let
                    a =
                        nextClientLabel 1783857600000 1

                    b =
                        nextClientLabel 1783857600000 2
                in
                Expect.all
                    [ \_ -> Expect.notEqual a b
                    , \_ -> Expect.equal True (String.length a > 0)
                    , \_ -> Expect.equal True (Base64Url.utf8ByteLength a <= maxLabelBytes)
                    , \_ -> Expect.equal True (Base64Url.utf8ByteLength b <= maxLabelBytes)
                    , \_ -> Expect.equal True (isValidLabel a)
                    , \_ -> Expect.equal True (isValidLabel b)
                    ]
                    ()
        , test "stays unique and valid across a burst past the pending bound" <|
            \_ ->
                let
                    labels =
                        List.map (nextClientLabel 1783857600000) (List.range 1 (maxPendingLabeledSends + 8))

                    unique =
                        List.foldl
                            (\l acc ->
                                if List.member l acc then
                                    acc

                                else
                                    l :: acc
                            )
                            []
                            labels
                in
                Expect.all
                    [ \_ -> Expect.equal (maxPendingLabeledSends + 8) (List.length unique)
                    , \_ -> Expect.equal True (List.all isValidLabel labels)
                    ]
                    ()
        , test "accepts ordinary ids, rejects empty/oversized/control values" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal True (isValidLabel "pQraCjj82e")
                    , \_ -> Expect.equal True (isValidLabel ("o" ++ String.repeat (maxLabelBytes - 1) "a"))
                    , \_ -> Expect.equal False (isValidLabel "")
                    , \_ -> Expect.equal False (isValidLabel (String.repeat (maxLabelBytes + 1) "a"))
                    , \_ -> Expect.equal False (isValidLabel "bad label")
                    , \_ -> Expect.equal False (isValidLabel "bad\nlabel")
                    , \_ -> Expect.equal False (isValidLabel "bad\tlabel")
                    , \_ -> Expect.equal False (isValidLabel ("has" ++ String.fromChar (Char.fromCode 0) ++ "null"))
                    ]
                    ()
        , test "measures the bound in UTF-8 bytes, not code points" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal False (isValidLabel (String.repeat 33 "é"))
                    , \_ -> Expect.equal True (isValidLabel (String.repeat 32 "é"))
                    ]
                    ()
        ]

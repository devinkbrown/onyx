module HistoryPolicyTest exposing (suite)

{-| Vectors ported from the `history-policy` contract in
`src/lib/irc/historyPolicy.ts`: known values pass through lowercased,
unknown/empty fail closed to `Public` (the server default).
-}

import Expect
import HistoryPolicy exposing (..)
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "HistoryPolicy"
        [ test "parses known policies case-insensitively" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal Public (parseHistoryPolicy (Just "public"))
                    , \_ -> Expect.equal Members (parseHistoryPolicy (Just "members"))
                    , \_ -> Expect.equal Opers (parseHistoryPolicy (Just "Opers"))
                    , \_ -> Expect.equal Members (parseHistoryPolicy (Just "  MEMBERS "))
                    ]
                    ()
        , test "fails closed to Public on unknown, empty, or absent values" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal Public (parseHistoryPolicy (Just "everyone"))
                    , \_ -> Expect.equal Public (parseHistoryPolicy (Just ""))
                    , \_ -> Expect.equal Public (parseHistoryPolicy Nothing)
                    ]
                    ()
        , test "exact-membership check is case-sensitive with no trim" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal True (isHistoryPolicy "public")
                    , \_ -> Expect.equal True (isHistoryPolicy "members")
                    , \_ -> Expect.equal True (isHistoryPolicy "opers")
                    , \_ -> Expect.equal False (isHistoryPolicy "Public")
                    , \_ -> Expect.equal False (isHistoryPolicy " members")
                    , \_ -> Expect.equal False (isHistoryPolicy "")
                    ]
                    ()
        , test "prop key is the wire-stable IRCX name" <|
            \_ -> Expect.equal "history-policy" historyPolicyProp
        ]

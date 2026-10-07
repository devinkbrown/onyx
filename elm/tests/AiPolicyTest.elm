module AiPolicyTest exposing (suite)

{-| Vectors ported from the pure sections of
`src/lib/irc/aiPolicyProp.test.ts` (store projection stays in `App`
later; parsing and gates are covered here).
-}

import AiPolicy exposing (..)
import Expect
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "AiPolicy"
        [ test "parses canonical PROP values" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal Open (parseAiPolicyProp "open")
                    , \_ -> Expect.equal NoAi (parseAiPolicyProp "no-ai")
                    , \_ -> Expect.equal LocalOnly (parseAiPolicyProp "local-only")
                    ]
                    ()
        , test "normalizes whitespace, case, and underscore variants" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal LocalOnly (parseAiPolicyProp " LOCAL_ONLY ")
                    , \_ -> Expect.equal NoAi (parseAiPolicyProp "No AI")
                    ]
                    ()
        , test "maps defensive aliases and defaults unknown values to open" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal NoAi (parseAiPolicyProp "disabled")
                    , \_ -> Expect.equal NoAi (parseAiPolicyProp "off")
                    , \_ -> Expect.equal LocalOnly (parseAiPolicyProp "local")
                    , \_ -> Expect.equal LocalOnly (parseAiPolicyProp "local-ai")
                    , \_ -> Expect.equal Open (parseAiPolicyProp "anything-else")
                    , \_ -> Expect.equal Open (parseAiPolicyProp "")
                    ]
                    ()
        , test "exposes gates for local and external AI surfaces" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal True (aiPolicyAllowsLocal Open)
                    , \_ -> Expect.equal True (aiPolicyAllowsLocal LocalOnly)
                    , \_ -> Expect.equal False (aiPolicyAllowsLocal NoAi)
                    , \_ -> Expect.equal True (aiPolicyAllowsExternal Open)
                    , \_ -> Expect.equal False (aiPolicyAllowsExternal LocalOnly)
                    , \_ -> Expect.equal False (aiPolicyAllowsExternal NoAi)
                    ]
                    ()
        , test "prop key is the wire-stable IRCX name" <|
            \_ -> Expect.equal "ai-policy" aiPolicyProp
        ]

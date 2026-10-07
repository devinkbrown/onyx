module AiPolicy exposing
    ( AiPolicy(..)
    , aiPolicyAllowsExternal
    , aiPolicyAllowsLocal
    , aiPolicyProp
    , parseAiPolicyProp
    )

{-| IRCX `ai-policy` channel prop helpers — Elm port of
`src/lib/irc/aiPolicyProp.ts`.

Fail closed toward the most permissive local default the server uses
(`open`), with defensive aliases (`disabled`/`off`/`none`/`blocked` →
`no-ai`, `local`/`local-ai` → `local-only`).
-}


aiPolicyProp : String
aiPolicyProp =
    "ai-policy"


type AiPolicy
    = Open
    | NoAi
    | LocalOnly


cleanPolicyValue : String -> String
cleanPolicyValue value =
    value
        |> String.trim
        |> String.toLower
        |> String.toList
        |> collapseSeparators False
        |> String.fromList


{-| Mirror `/[\s_]+/g → '-'`: every maximal separator run becomes exactly
one dash, including runs at the edges.
-}
collapseSeparators : Bool -> List Char -> List Char
collapseSeparators prevSep chars =
    case chars of
        [] ->
            []

        c :: rest ->
            if c == '_' || Char.toCode c <= 0x20 then
                if prevSep then
                    collapseSeparators True rest

                else
                    '-' :: collapseSeparators True rest

            else
                c :: collapseSeparators False rest


parseAiPolicyProp : String -> AiPolicy
parseAiPolicyProp value =
    case cleanPolicyValue value of
        "open" ->
            Open

        "no-ai" ->
            NoAi

        "local-only" ->
            LocalOnly

        "none" ->
            NoAi

        "off" ->
            NoAi

        "disabled" ->
            NoAi

        "blocked" ->
            NoAi

        "local" ->
            LocalOnly

        "local-ai" ->
            LocalOnly

        _ ->
            Open


aiPolicyAllowsLocal : AiPolicy -> Bool
aiPolicyAllowsLocal policy =
    policy == Open || policy == LocalOnly


aiPolicyAllowsExternal : AiPolicy -> Bool
aiPolicyAllowsExternal policy =
    policy == Open

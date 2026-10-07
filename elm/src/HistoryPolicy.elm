module HistoryPolicy exposing
    ( HistoryPolicy(..)
    , historyPolicyProp
    , isHistoryPolicy
    , parseHistoryPolicy
    )

{-| IRCX `history-policy` channel prop helpers — Elm port of
`src/lib/irc/historyPolicy.ts`.

Server values: `public` (anyone who can open CHATHISTORY may read;
default), `members` (members only), `opers` (ops/network opers only).

Fail closed: unknown/empty → `Public` (matches the server default).
-}


historyPolicyProp : String
historyPolicyProp =
    "history-policy"


type HistoryPolicy
    = Public
    | Members
    | Opers


parseHistoryPolicy : Maybe String -> HistoryPolicy
parseHistoryPolicy raw =
    case String.toLower (String.trim (Maybe.withDefault "" raw)) of
        "public" ->
            Public

        "members" ->
            Members

        "opers" ->
            Opers

        _ ->
            Public


{-| Exact-membership check on untrusted strings (case-sensitive, no
trim — mirroring the oracle). Well-typed `HistoryPolicy` values are
valid by construction.
-}
isHistoryPolicy : String -> Bool
isHistoryPolicy value =
    value == "public" || value == "members" || value == "opers"

module Integrations exposing (featureLabel, phaseLabel, reasonLabel)

{-| Plain-language labels for the server-backed service integration panel.
This module only presents the typed runtime projection; command construction,
permission checks, private inputs, and reply correlation stay in the browser runtime.
-}


featureLabel : String -> String
featureLabel feature =
    case feature of
        "botgrant" -> "Bot grants"
        "botcmd" -> "Bot commands"
        "defer" -> "Deferred actions"
        "outhook" -> "Outbound hooks"
        "unfurl" -> "Link previews"
        "memo" -> "Offline memos"
        "webhook" -> "Incoming webhooks"
        _ -> "Service integration"


phaseLabel : String -> String
phaseLabel phase =
    case phase of
        "pending" -> "Waiting for the server"
        "accepted" -> "Server confirmed"
        "rejected" -> "Server rejected the request"
        "unknown" -> "Outcome unknown; review before retrying"
        "unsupported" -> "Unavailable on this connection"
        "blocked" -> "Not sent"
        _ -> "Ready"


reasonLabel : Maybe String -> Maybe String
reasonLabel reason =
    Maybe.map
        (\value ->
            case value of
                "invalid-request" -> "Check the values and try again."
                "owner-changed" -> "The active account or connection changed."
                "account-proof-required" -> "Sign in to the account first."
                "feature-disabled" -> "This feature is disabled on the server."
                "feature-unknown" -> "Refresh the feature status before using it."
                "registry-disabled" -> "This command is not registered on this connection."
                "busy" -> "Another service request is still in progress."
                "offline" -> "The connection is offline."
                "backpressure" -> "The connection could not accept the request."
                "transport-error" -> "The send outcome is unknown. Review status before retrying."
                "response-timeout" -> "The server response did not finish. Review status before retrying."
                "invalid-response" -> "The server response did not match this request."
                "permission-denied" -> "The server denied this operation."
                "server-rejected" -> "The server rejected this operation."
                "input-expired" -> "The private input expired. Enter it again."
                "input-invalid" -> "The private input did not meet the server limits."
                _ -> "The operation could not be completed."
        )
        reason

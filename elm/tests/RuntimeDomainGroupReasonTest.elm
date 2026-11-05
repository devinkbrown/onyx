module RuntimeDomainGroupReasonTest exposing (suite)

import Expect
import Json.Decode as Decode
import Json.Encode as Encode
import RuntimeDomain
import Test exposing (Test, describe, test)


{-| The private runtime settles refused group actions with bounded reasons. A
result whose reason fails to decode is dropped by Main, which leaves the Local
services panel stuck on "Request pending…" (observed in the local lab when a
room key update could not be planned).
-}
groupResult : String -> String -> Encode.Value
groupResult action reason =
    Encode.object
        [ ( "schemaVersion", Encode.int 1 )
        , ( "requestId", Encode.string "domainRequest000000000001" )
        , ( "ownerRef", Encode.string "owner_test_valid_00000001" )
        , ( "accountGeneration", Encode.int 1 )
        , ( "connectionGeneration", Encode.int 1 )
        , ( "domain", Encode.string "group" )
        , ( "action", Encode.string action )
        , ( "status", Encode.string "blocked" )
        , ( "completionScope", Encode.string "local" )
        , ( "reason", Encode.string reason )
        , ( "view"
          , Encode.object
                [ ( "kind", Encode.string "group" )
                , ( "phase", Encode.string "blocked" )
                , ( "conversationId", Encode.string "#room" )
                , ( "epoch", Encode.null )
                , ( "currentCommitHashHex", Encode.null )
                , ( "plan", Encode.null )
                , ( "devices", Encode.list identity [] )
                , ( "operationRef", Encode.null )
                , ( "historyOnly", Encode.bool False )
                , ( "bootstrap", Encode.null )
                , ( "backupPreview", Encode.null )
                , ( "backupOutcome", Encode.string "none" )
                ]
          )
        ]


decodesWithReason : String -> String -> Expect.Expectation
decodesWithReason action reason =
    Decode.decodeValue RuntimeDomain.decodeResult (groupResult action reason)
        |> Result.map (\result -> ( result.status, result.reason ))
        |> Expect.equal (Ok ( RuntimeDomain.Blocked, Just reason ))


suite : Test
suite =
    describe "RuntimeDomain group refusals settle the pending request"
        [ test "an unplannable room key update decodes as blocked" <|
            \_ -> decodesWithReason "author-plan" "group-plan-unavailable"
        , test "an unavailable bootstrap checkpoint decodes as blocked" <|
            \_ -> decodesWithReason "bootstrap-preview" "bootstrap-preview-unavailable"
        , test "an incomplete directory decodes as blocked" <|
            \_ -> decodesWithReason "directory-refresh" "membership-incomplete"
        , test "every bounded group refusal reason decodes" <|
            \_ ->
                [ "plan-unavailable", "invalid-commit-hash", "group-action-unavailable", "bootstrap-approval-failed"
                , "backup-private-ref-unavailable", "backup-password-unavailable", "backup-preview-unavailable", "invalid-backup-preview"
                , "private-output-unavailable", "wrong-network", "accepted-epoch-unavailable", "epoch-material-unavailable"
                , "device-trust-unavailable"
                ]
                    |> List.filter (\reason -> Decode.decodeValue RuntimeDomain.decodeResult (groupResult "author-plan" reason) |> Result.toMaybe |> (==) Nothing)
                    |> Expect.equal []
        , test "a device trust review decodes into a fingerprint item bound to its preview ref" <|
            \_ ->
                Decode.decodeString (Decode.map RuntimeDomain.decodeGroupItems Decode.value)
                    ("{\"phase\":\"device-trust-review\",\"conversationId\":\"#room\",\"epoch\":null,\"currentCommitHashHex\":null,\"plan\":null,\"operationRef\":null,\"bootstrap\":null,\"backupPreview\":null,\"devices\":[],\"deviceTrust\":{\"previewRef\":\""
                        ++ String.repeat 48 "b" ++ "\",\"accountId\":\"bob\",\"deviceId\":\"ogc1-Tablet\",\"fingerprintHex\":\"" ++ String.repeat 64 "c" ++ "\"}}")
                    |> Result.map (List.map (\item -> ( item.ref, item.state, item.extra )))
                    |> Expect.equal (Ok [ ( String.repeat 48 "b", "device-trust-preview:" ++ String.repeat 64 "c", [ "bob", "ogc1-Tablet" ] ) ])
        , test "a device trust review with a malformed fingerprint lists nothing" <|
            \_ ->
                Decode.decodeString (Decode.map RuntimeDomain.decodeGroupItems Decode.value)
                    ("{\"phase\":\"device-trust-review\",\"conversationId\":\"#room\",\"epoch\":null,\"currentCommitHashHex\":null,\"plan\":null,\"operationRef\":null,\"bootstrap\":null,\"backupPreview\":null,\"devices\":[],\"deviceTrust\":{\"previewRef\":\""
                        ++ String.repeat 48 "b" ++ "\",\"accountId\":\"bob\",\"deviceId\":\"tablet\",\"fingerprintHex\":\"XYZ\"}}")
                    |> Result.map List.length
                    |> Expect.equal (Ok 0)
        , test "free-form reasons are still rejected" <|
            \_ ->
                Decode.decodeValue RuntimeDomain.decodeResult (groupResult "author-plan" "PRIVMSG #room :secret")
                    |> Result.toMaybe
                    |> Expect.equal Nothing
        ]

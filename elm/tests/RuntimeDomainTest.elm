module RuntimeDomainTest exposing (suite)

import Expect
import Json.Decode as Decode
import RuntimeDomain
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "RuntimeDomain typed inventories"
        [ test "accepts a zero-row mesh page with explicit continuation" <|
            \_ ->
                decodeJson RuntimeDomain.decodeSessionInventoryView
                    "{\"requestId\":\"request_id_000000000001\",\"mode\":\"mesh\",\"status\":\"partial\",\"scanRef\":\"scan_reference_00000001\",\"localRows\":[],\"meshRows\":[],\"continuationAvailable\":true,\"scanComplete\":false,\"pageCount\":1,\"lastObservedAt\":\"9223372036854775807\",\"reason\":null}"
                    |> Expect.ok
        , test "rejects local row data in a mesh inventory" <|
            \_ ->
                decodeJson RuntimeDomain.decodeSessionInventoryView
                    "{\"requestId\":\"request_id_000000000001\",\"mode\":\"mesh\",\"status\":\"ready\",\"scanRef\":null,\"localRows\":[{\"rowRef\":\"local_row_reference_0001\",\"index\":1,\"signonMs\":\"0\",\"state\":\"attached\",\"current\":false}],\"meshRows\":[],\"continuationAvailable\":false,\"scanComplete\":true,\"pageCount\":0,\"lastObservedAt\":null,\"reason\":null}"
                    |> Expect.err
        , describe "group directory devices"
            (let
                hash =
                    String.repeat 64 "a"

                directory epoch commitHash =
                    "{\"phase\":\"directory-refreshed\",\"conversationId\":\"#room\",\"epoch\":" ++ epoch ++ ",\"currentCommitHashHex\":" ++ commitHash
                        ++ ",\"plan\":null,\"operationRef\":null,\"bootstrap\":null,\"backupPreview\":null,\"devices\":[{\"accountId\":\"bob\",\"deviceId\":\"tablet\",\"trusted\":\"untrusted\",\"current\":false}]}"

                deviceRows json =
                    decodeJson (\value -> Ok (RuntimeDomain.decodeGroupItems value)) json
                        |> Result.map (List.filter (\item -> item.state == "group-device"))
             in
             [ test "binds each removable device to the verified room head" <|
                \_ ->
                    deviceRows (directory "7" ("\"" ++ hash ++ "\""))
                        |> Result.map (List.map (\item -> ( item.ref, item.extra )))
                        |> Expect.equal (Ok [ ( "#room", [ "bob", "tablet", "untrusted", "7", hash ] ) ])
             , test "lists nothing removable without a verified head" <|
                \_ ->
                    deviceRows (directory "null" "null")
                        |> Expect.equal (Ok [])
             ]
            )
        , test "preserves account-community operation status without optimistic rows" <|
            \_ ->
                decodeJson RuntimeDomain.decodeAccountCommunityView
                    "{\"requestId\":\"request_id_000000000001\",\"section\":\"autojoin\",\"status\":\"pending\",\"operation\":\"add\",\"autojoinRows\":[],\"groupRows\":[],\"reason\":null}"
                    |> Result.map (\view -> ( view.status, view.operation, view.autojoinRows ))
                    |> Expect.equal (Ok ( "pending", "add", [] ))
        , test "accepts explicitly truncated draft inventory and preserves recovered newlines" <|
            \_ ->
                decodeJson RuntimeDomain.decodeDraftRecoveryView
                    "{\"requestId\":\"request_id_000000000001\",\"status\":\"ready\",\"items\":[],\"recovered\":{\"draftRef\":\"draft_reference_000000000001\",\"conversationId\":\"#room\",\"revision\":9007199254740991,\"text\":\"first\\r\\nsecond\"},\"truncated\":true,\"reason\":null}"
                    |> Result.map (\view -> ( view.truncated, Maybe.map .text view.recovered ))
                    |> Expect.equal (Ok ( True, Just "first\r\nsecond" ))
        , test "rejects draft plaintext containing NUL" <|
            \_ ->
                decodeJson RuntimeDomain.decodeDraftRecoveryView
                    "{\"requestId\":\"request_id_000000000001\",\"status\":\"ready\",\"items\":[],\"recovered\":{\"draftRef\":\"draft_reference_000000000001\",\"conversationId\":\"#room\",\"revision\":1,\"text\":\"bad\\u0000text\"},\"truncated\":false,\"reason\":null}"
                    |> Expect.err
        , test "keeps desired media policy distinct from unavailable observations" <|
            \_ ->
                decodeJson RuntimeDomain.decodeMediaQualityView
                    "{\"requestId\":\"request_id_000000000001\",\"conversationId\":\"#room\",\"callRef\":\"call_reference_000000001\",\"desiredPolicy\":\"audio-priority\",\"observedNetworkTier\":null,\"observedAudioQuality\":null,\"videoState\":\"unknown\"}"
                    |> Result.map (\view -> ( view.desiredPolicy, view.observedNetworkTier, view.videoState ))
                    |> Expect.equal (Ok ( "audio-priority", Nothing, "unknown" ))
        , test "rejects media quality observations outside the source enum bounds" <|
            \_ ->
                decodeJson RuntimeDomain.decodeMediaQualityView
                    "{\"requestId\":\"request_id_000000000001\",\"conversationId\":\"#room\",\"callRef\":\"call_reference_000000001\",\"desiredPolicy\":\"auto\",\"observedNetworkTier\":4,\"observedAudioQuality\":0,\"videoState\":\"inactive\"}"
                    |> Expect.err
        , test "decodes the full media snapshot with independently unavailable counters" <|
            \_ ->
                decodeMediaControlJson mediaSnapshotJson
                    |> Result.map (\view -> { sequence = view.sequence, recording = view.recording.actual, counterCount = List.length view.telemetry.counters, availability = view.telemetry.availability })
                    |> Expect.equal (Ok { sequence = 9, recording = "inactive", counterCount = 9, availability = "partial" })
        , test "rejects non-loopback WebRTC scope and false caption disclosure" <|
            \_ ->
                let
                    withLoopback = String.replace "\"webRtc\":null" "\"webRtc\":{\"scope\":\"same-browser-loopback\",\"reason\":null,\"connectionState\":\"connected\",\"bytes\":1,\"packets\":1,\"frames\":null,\"durationMs\":5}" mediaSnapshotJson
                    wrongScope = String.replace "same-browser-loopback" "remote-peer" withLoopback
                    falseDisclosure = String.replace "\"caption\":null" "\"caption\":{\"conversationId\":\"#room\",\"callRef\":\"call_reference_000000001\",\"state\":\"listening\",\"reason\":null,\"mode\":\"local\",\"language\":\"en-US\",\"source\":\"local-participant-microphone\",\"accuracy\":\"unknown\",\"interimText\":null,\"serverVisible\":false}" mediaSnapshotJson
                in
                Expect.all
                    [ \_ -> decodeMediaControlJson wrongScope |> Expect.err
                    , \_ -> decodeMediaControlJson falseDisclosure |> Expect.err
                    ]
                    ()
        , test "decodes service integration rows as safe labels and opaque references" <|
            \_ ->
                decodeJson RuntimeDomain.decodeServiceIntegrationView
                    "{\"kind\":\"service-integration\",\"requestId\":\"request_id_000000000001\",\"feature\":\"unfurl\",\"operation\":\"preview\",\"phase\":\"accepted\",\"registry\":\"enabled\",\"effectiveFeature\":\"enabled\",\"accountProof\":\"unknown\",\"authorization\":\"allowed\",\"reason\":null,\"rows\":[{\"kind\":\"entry\",\"label\":\"Title\",\"value\":\"Example page\",\"ref\":null}],\"inputRef\":null}"
                    |> Result.map (\view -> ( view.feature, view.operation, List.map .value view.rows ))
                    |> Expect.equal (Ok ( "unfurl", Just "preview", [ Just "Example page" ] ))
        , test "rejects service operations that do not belong to the declared feature" <|
            \_ ->
                decodeJson RuntimeDomain.decodeServiceIntegrationView
                    "{\"kind\":\"service-integration\",\"requestId\":\"request_id_000000000001\",\"feature\":\"unfurl\",\"operation\":\"remove\",\"phase\":\"accepted\",\"registry\":\"enabled\",\"effectiveFeature\":\"enabled\",\"accountProof\":\"unknown\",\"authorization\":\"allowed\",\"reason\":null,\"rows\":[],\"inputRef\":null}"
                    |> Expect.err
        , test "rejects integration rows with a non-opaque reference" <|
            \_ ->
                decodeJson RuntimeDomain.decodeServiceIntegrationView
                    "{\"kind\":\"service-integration\",\"requestId\":\"request_id_000000000001\",\"feature\":\"outhook\",\"operation\":\"list\",\"phase\":\"accepted\",\"registry\":\"enabled\",\"effectiveFeature\":\"unknown\",\"accountProof\":\"unknown\",\"authorization\":\"unknown\",\"reason\":null,\"rows\":[{\"kind\":\"entry\",\"label\":\"Webhook endpoint\",\"value\":\"Stored webhook\",\"ref\":\"https://secret.example/path?token=secret\"}],\"inputRef\":null}"
                    |> Expect.err
        ]


decodeMediaControlJson : String -> Result Decode.Error RuntimeDomain.MediaControlView
decodeMediaControlJson raw =
    decodeJson RuntimeDomain.decodeMediaControlView raw


decodeJson : (Decode.Value -> Result Decode.Error a) -> String -> Result Decode.Error a
decodeJson decoder raw =
    Decode.decodeString Decode.value raw
        |> Result.andThen decoder


mediaSnapshotJson : String
mediaSnapshotJson =
    "{\"sequence\":9,\"state\":\"in-call\",\"previewRef\":null,\"screenRef\":null,\"experimentRef\":null,\"experiment\":null,\"call\":{\"conversationId\":\"#room\",\"callRef\":\"call_reference_000000001\"},\"reason\":null,\"muted\":false,\"deafened\":false,\"devices\":{\"inputs\":[],\"outputs\":[],\"selectedInputRef\":null,\"requestedInputRef\":null,\"appliedInputRef\":null,\"inputState\":\"idle\",\"inputReason\":null,\"selectedOutputRef\":null,\"requestedOutputRef\":null,\"appliedOutputRef\":null,\"outputState\":\"idle\",\"outputReason\":null,\"requestedVolumePercent\":50,\"appliedVolumePercent\":null},\"soundcheck\":null,\"recording\":{\"ownConsent\":\"unknown\",\"consentRequest\":\"idle\",\"desiredAction\":null,\"requestState\":\"idle\",\"actual\":\"inactive\",\"rosterState\":\"unknown\",\"allConsented\":null,\"policyRevision\":null,\"reason\":null},\"telemetry\":{\"sampledAtMonotonicMs\":10,\"counters\":{\"audioUnderruns\":null,\"queuedAudioFrames\":1,\"lateAudioFrames\":null,\"droppedAudioFrames\":null,\"droppedVideoFrames\":null,\"encodedAudioFrames\":null,\"decodedAudioFrames\":null,\"encodedVideoFrames\":null,\"decodedVideoFrames\":null},\"availability\":\"partial\",\"reason\":\"counter-read-failed\"},\"caption\":null,\"webRtc\":null}"

module MainTest exposing (suite)

import App exposing (Msg(..))
import Expect
import Json.Decode as Decode
import Main exposing (runtimeCapturePreparedMessage, wsFramesMessage)
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "runtime port decoders"
        [ describe "runtime capture port"
            [ test "preserves transport-unavailable as a typed capture denial" <|
                \_ ->
                    case Decode.decodeString Decode.value captureUnavailableJson of
                        Err error ->
                            Expect.fail (Decode.errorToString error)

                        Ok value ->
                            case runtimeCapturePreparedMessage value of
                                RuntimeCapturePrepared result ->
                                    Expect.equal ( Just "transport-unavailable", False ) ( result.reason, result.available )

                                _ ->
                                    Expect.fail "The capture result was discarded instead of preserving its transport reason."
            ]
        , describe "owner-stamped WebSocket frames"
            [ test "decodes owner stamp and frame receipt times" <|
                \_ ->
                    Expect.equal
                        (WsFramesReceived
                            { owner =
                                { ownerRef = "owner_capture_000000000001"
                                , networkId = "net_frames"
                                , accountId = Just "alice"
                                , accountGeneration = 2
                                , connectionGeneration = 4
                                }
                            , frames = [ { at = 42000, lines = [ ":server PING :batch" ] } ]
                            }
                        )
                        (decodeWsFrames frameBatchJson)
            , test "rejects a missing owner and malformed owner or frame fields" <|
                \_ ->
                    Expect.equal
                        [ SessionCredentialsIgnored
                        , SessionCredentialsIgnored
                        , SessionCredentialsIgnored
                        , SessionCredentialsIgnored
                        ]
                        [ decodeWsFrames missingOwnerJson
                        , decodeWsFrames invalidAccountJson
                        , decodeWsFrames invalidGenerationJson
                        , decodeWsFrames invalidFrameTimeJson
                        ]
            ]
        ]


decodeWsFrames : String -> Msg
decodeWsFrames json =
    case Decode.decodeString Decode.value json of
        Ok value ->
            wsFramesMessage value

        Err _ ->
            SessionCredentialsIgnored


captureUnavailableJson : String
captureUnavailableJson =
    "{\"ownerRef\":\"owner_capture_000000000001\",\"connectionGeneration\":4,\"accountGeneration\":2,\"conversationId\":\"#room\",\"captureRef\":\"capture_reference_0000001\",\"kind\":\"voice\",\"available\":false,\"reason\":\"transport-unavailable\",\"deviceRef\":null,\"callRef\":null}"


frameBatchJson : String
frameBatchJson =
    "{\"owner\":{\"ownerRef\":\"owner_capture_000000000001\",\"networkId\":\"net_frames\",\"accountId\":\"alice\",\"accountGeneration\":2,\"connectionGeneration\":4},\"frames\":[{\"at\":42000,\"lines\":[\":server PING :batch\"]}]}"


missingOwnerJson : String
missingOwnerJson =
    "{\"frames\":[{\"at\":1,\"lines\":[\":s PING :x\"]}]}"


invalidAccountJson : String
invalidAccountJson =
    "{\"owner\":{\"ownerRef\":\"owner_capture_000000000001\",\"networkId\":\"net_frames\",\"accountId\":\"bad account\",\"accountGeneration\":2,\"connectionGeneration\":4},\"frames\":[]}"


invalidGenerationJson : String
invalidGenerationJson =
    "{\"owner\":{\"ownerRef\":\"owner_capture_000000000001\",\"networkId\":\"net_frames\",\"accountId\":null,\"accountGeneration\":\"2\",\"connectionGeneration\":4},\"frames\":[]}"


invalidFrameTimeJson : String
invalidFrameTimeJson =
    "{\"owner\":{\"ownerRef\":\"owner_capture_000000000001\",\"networkId\":\"net_frames\",\"accountId\":null,\"accountGeneration\":2,\"connectionGeneration\":4},\"frames\":[{\"at\":\"1\",\"lines\":[]}]}"

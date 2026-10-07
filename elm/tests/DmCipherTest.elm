module DmCipherTest exposing (suite)

import Base64Url
import Dict
import DmCipher exposing (..)
import Expect
import Test exposing (..)


{-| A structurally valid peer point: 0x04 followed by 64 filler bytes,
base64url-encoded like the METADATA value.
-}
validKey : Int -> String
validKey fill =
    Base64Url.encode (0x04 :: List.repeat 64 fill)


k1 : String
k1 =
    validKey 0xAB


k2 : String
k2 =
    validKey 0xCD


suite : Test
suite =
    describe "DmCipher"
        [ describe "envelope detection"
            [ test "single prefix detected" <|
                \_ -> isEnvelope "ONYXDM1 abc" |> Expect.equal True
            , test "multi prefix detected" <|
                \_ -> isEnvelope "ONYXDMN1 abc" |> Expect.equal True
            , test "plaintext is not an envelope" <|
                \_ -> isEnvelope "hello" |> Expect.equal False
            , test "multi checked before single" <|
                \_ -> envelopeBodyOffset "ONYXDMN1 abc" |> Expect.equal 9
            , test "single offset is 8" <|
                \_ -> envelopeBodyOffset "ONYXDM1 abc" |> Expect.equal 8
            , test "unknown offset is -1" <|
                \_ -> envelopeBodyOffset "plain" |> Expect.equal -1
            , test "locked placeholder text" <|
                \_ -> lockedPlaceholder |> Expect.equal "\u{1F512} Encrypted message (sent to another device)"
            ]
        , describe "peer key shape"
            [ test "65-byte 0x04 point validates" <|
                \_ -> isValidPeerPublicKey k1 |> Expect.equal True
            , test "short input rejected" <|
                \_ -> isValidPeerPublicKey "AAAA" |> Expect.equal False
            , test "empty rejected" <|
                \_ -> isValidPeerPublicKey "" |> Expect.equal False
            , test "alphabet drift rejected" <|
                \_ -> isValidPeerPublicKey "not valid!!" |> Expect.equal False
            , test "wrong lead byte rejected" <|
                \_ -> Base64Url.encode (0x05 :: List.repeat 64 0) |> isValidPeerPublicKey |> Expect.equal False
            ]
        , describe "normalizePeerDeviceKeys"
            [ test "trims, dedupes, drops invalid" <|
                \_ ->
                    normalizePeerDeviceKeys [ " " ++ k1 ++ " ", k1, "AAAA", "", k2 ]
                        |> Expect.equal [ k1, k2 ]
            , test "caps at 16 seals" <|
                \_ ->
                    List.range 1 17
                        |> List.map (\i -> validKey i)
                        |> normalizePeerDeviceKeys
                        |> List.length
                        |> Expect.equal 16
            ]
        , describe "multi-seal codec"
            [ test "pack/unpack round-trips" <|
                \_ ->
                    let
                        bodies =
                            [ List.repeat 28 1, List.repeat 40 2 ]
                    in
                    encodeMultiSealBodies bodies
                        |> Maybe.andThen decodeMultiSealBodies
                        |> Expect.equal (Just bodies)
            , test "empty seal list refused" <|
                \_ -> encodeMultiSealBodies [] |> Expect.equal Nothing
            , test "short body refused" <|
                \_ -> encodeMultiSealBodies [ List.repeat 10 1 ] |> Expect.equal Nothing
            , test "zero count refused" <|
                \_ -> decodeMultiSealBodies [ 0, 0 ] |> Expect.equal Nothing
            , test "over-cap count refused" <|
                \_ -> decodeMultiSealBodies [ 0, 17 ] |> Expect.equal Nothing
            , test "trailing garbage refused" <|
                \_ ->
                    encodeMultiSealBodies [ List.repeat 28 7 ]
                        |> Maybe.map (\packed -> decodeMultiSealBodies (packed ++ [ 0 ]))
                        |> Expect.equal (Just Nothing)
            , test "truncated body refused" <|
                \_ -> decodeMultiSealBodies [ 0, 1, 0, 28, 1, 2 ] |> Expect.equal Nothing
            ]
        , describe "parseEnvelopeBody"
            [ test "single body parses" <|
                \_ ->
                    parseEnvelopeBody ("ONYXDM1 " ++ Base64Url.encode (List.repeat 28 9))
                        |> Expect.equal (Just (SingleBody (List.repeat 28 9)))
            , test "short single body refused" <|
                \_ ->
                    parseEnvelopeBody ("ONYXDM1 " ++ Base64Url.encode (List.repeat 10 9))
                        |> Expect.equal Nothing
            , test "multi body parses" <|
                \_ ->
                    let
                        bodies =
                            [ List.repeat 28 3 ]
                    in
                    encodeMultiSealBodies bodies
                        |> Maybe.map (Base64Url.encode >> (++) "ONYXDMN1 " >> parseEnvelopeBody)
                        |> Expect.equal (Just (Just (MultiBodies bodies)))
            , test "missing prefix refused" <|
                \_ -> parseEnvelopeBody "hello" |> Expect.equal Nothing
            , test "bad base64url refused" <|
                \_ -> parseEnvelopeBody "ONYXDM1 !!!" |> Expect.equal Nothing
            ]
        , describe "TOFU verdicts"
            [ test "unreadable store fails closed" <|
                \_ -> peerKeyStatus PinUnreadable k1 |> Expect.equal Unreadable
            , test "absent pin is first use" <|
                \_ -> peerKeyStatus PinAbsent k1 |> Expect.equal FirstUse
            , test "same key is unchanged" <|
                \_ -> peerKeyStatus (PinRaw k1) k1 |> Expect.equal Unchanged
            , test "different key is changed" <|
                \_ -> peerKeyStatus (PinRaw k1) k2 |> Expect.equal Changed
            , test "corrupt pin matching presented is unchanged" <|
                \_ -> peerKeyStatus (PinRaw "AAAA") "AAAA" |> Expect.equal Unchanged
            , test "corrupt pin otherwise is changed" <|
                \_ -> peerKeyStatus (PinRaw "AAAA") k1 |> Expect.equal Changed
            , test "empty presented set is unreadable" <|
                \_ -> peerDeviceSetStatus PinAbsent [] |> Expect.equal Unreadable
            , test "absent pin with keys is first use" <|
                \_ -> peerDeviceSetStatus PinAbsent [ k1 ] |> Expect.equal FirstUse
            , test "pinned set covering presented is unchanged" <|
                \_ ->
                    peerDeviceSetStatus (PinRaw ("{\"v\":1,\"k\":[\"" ++ k1 ++ "\",\"" ++ k2 ++ "\"]}")) [ k2, k1 ]
                        |> Expect.equal Unchanged
            , test "new key after a pin is changed" <|
                \_ -> peerDeviceSetStatus (PinRaw k1) [ k1, k2 ] |> Expect.equal Changed
            , test "corrupt pin with keys is changed" <|
                \_ -> peerDeviceSetStatus (PinRaw "AAAA") [ k1 ] |> Expect.equal Changed
            ]
        , describe "safety groups"
            [ test "zero digest is all-zero groups" <|
                \_ ->
                    encodeSafetyGroups (List.repeat 60 0) 12
                        |> Expect.equal (Just "00000 00000 00000 00000 00000 00000 00000 00000 00000 00000 00000 00000")
            , test "unit window encodes to 00001" <|
                \_ ->
                    encodeSafetyGroups [ 0, 0, 0, 0, 1 ] 1
                        |> Expect.equal (Just "00001")
            , test "256 encodes to 00256" <|
                \_ ->
                    encodeSafetyGroups [ 0, 0, 0, 1, 0 ] 1
                        |> Expect.equal (Just "00256")
            , test "short digest refused" <|
                \_ -> encodeSafetyGroups [ 1, 2, 3 ] 1 |> Expect.equal Nothing
            ]
        , describe "registry id"
            [ test "32 zero bytes give web- plus 20 As" <|
                \_ ->
                    registryIdFromDigest (List.repeat 32 0)
                        |> Expect.equal (Just ("web-" ++ String.repeat 20 "A"))
            , test "wrong digest length refused" <|
                \_ -> registryIdFromDigest (List.repeat 31 0) |> Expect.equal Nothing
            ]
        , describe "device directory"
            [ test "valid single key sets primary and merges devices" <|
                \_ ->
                    applySingleKey "dave" k1 blankDirectory
                        |> (\d ->
                                Expect.all
                                    [ \_ -> Expect.equal (Just k1) (Dict.get "dave" d.primary)
                                    , \_ -> Expect.equal (Just [ k1 ]) (Dict.get "dave" d.devices)
                                    ]
                                    ()
                           )
            , test "invalid single key deletes primary, keeps devices" <|
                \_ ->
                    blankDirectory
                        |> applySingleKey "dave" k1
                        |> applySingleKey "dave" "AAAA"
                        |> (\d ->
                                Expect.all
                                    [ \_ -> Expect.equal Nothing (Dict.get "dave" d.primary)
                                    , \_ -> Expect.equal (Just [ k1 ]) (Dict.get "dave" d.devices)
                                    ]
                                    ()
                           )
            , test "key list replaces devices and backfills primary" <|
                \_ ->
                    applyKeyList "dave" [ k1, k2 ] blankDirectory
                        |> (\d ->
                                Expect.all
                                    [ \_ -> Expect.equal (Just [ k1, k2 ]) (Dict.get "dave" d.devices)
                                    , \_ -> Expect.equal (Just k1) (Dict.get "dave" d.primary)
                                    ]
                                    ()
                           )
            , test "existing primary survives a list update" <|
                \_ ->
                    blankDirectory
                        |> applySingleKey "dave" k1
                        |> applyKeyList "dave" [ k2 ]
                        |> (\d -> Expect.equal (Just k1) (Dict.get "dave" d.primary))
            , test "empty list deletes devices, keeps primary" <|
                \_ ->
                    blankDirectory
                        |> applySingleKey "dave" k1
                        |> applyKeyList "dave" []
                        |> (\d ->
                                Expect.all
                                    [ \_ -> Expect.equal Nothing (Dict.get "dave" d.devices)
                                    , \_ -> Expect.equal (Just k1) (Dict.get "dave" d.primary)
                                    ]
                                    ()
                           )
            , test "metadata value bound at 8K" <|
                \_ ->
                    boundMetadataValue (String.repeat 9000 "a")
                        |> String.length
                        |> Expect.equal 8192
            ]
        , describe "designation"
            [ designationTests ]
        ]


designationTests : Test
designationTests =
    let
        plain =
            { chantypes = "#&"
            , keyChanged = False
            , hasPrimaryKey = False
            , directoryDevices = []
            , hasEncryptedBoundary = False
            }
    in
    describe "isDmE2eeDesignated"
        [ test "channels never designate" <|
            \_ -> isDmE2eeDesignated plain "#room" |> Expect.equal False
        , test "empty peer never designates" <|
            \_ -> isDmE2eeDesignated plain "  " |> Expect.equal False
        , test "key change designates" <|
            \_ -> isDmE2eeDesignated { plain | keyChanged = True } "dave" |> Expect.equal True
        , test "published legacy key designates" <|
            \_ -> isDmE2eeDesignated { plain | hasPrimaryKey = True } "dave" |> Expect.equal True
        , test "nonempty directory designates even when corrupt" <|
            \_ -> isDmE2eeDesignated { plain | directoryDevices = [ "AAAA" ] } "dave" |> Expect.equal True
        , test "encrypted history designates" <|
            \_ -> isDmE2eeDesignated { plain | hasEncryptedBoundary = True } "dave" |> Expect.equal True
        , test "genuinely plain DM does not designate" <|
            \_ -> isDmE2eeDesignated plain "bob" |> Expect.equal False
        ]

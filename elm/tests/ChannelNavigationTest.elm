module ChannelNavigationTest exposing (suite)

import ChannelNavigation exposing (storageKey)
import Expect
import Json.Decode as Decode
import Json.Encode as Encode
import Test exposing (Test, describe, test)


value : String -> Decode.Value
value json =
    Decode.decodeString Decode.value json |> Result.withDefault Encode.null


suite : Test
suite =
    describe "channel navigation"
        [ test "rejects a name that is not a room" <|
            \_ ->
                Expect.equal Nothing (ChannelNavigation.normalizeChannel "lobby")
        , test "trims and lowercases a room" <|
            \_ ->
                Expect.equal (Just "#private") (ChannelNavigation.normalizeChannel " #Private ")
        , test "keeps the first 256 rooms in arrival order" <|
            \_ ->
                let
                    names =
                        List.range 1 300 |> List.map (\n -> "#" ++ String.fromInt n)

                    parsed =
                        ChannelNavigation.parseValue
                            (Encode.object [ ( "starredChannels", Encode.list Encode.string names ) ])
                in
                Expect.all
                    [ \_ -> Expect.equal 256 (List.length parsed.starred)
                    , \_ -> Expect.equal (Just "#1") (List.head parsed.starred)
                    , \_ -> Expect.equal (Just "#256") (List.head (List.reverse parsed.starred))
                    ]
                    ()
        , test "channel order keeps the first spelling of each room" <|
            \_ ->
                let
                    parsed =
                        ChannelNavigation.parseValue
                            (value "{\"channelOrder\":[\"#Second\",\"#FIRST\",\"#second\"]}")
                in
                Expect.equal [ "#second", "#first" ] parsed.channelOrder
        , test "folders trim names and claim each room once" <|
            \_ ->
                let
                    parsed =
                        ChannelNavigation.parseValue
                            (value "{\"channelFolders\":[{\"id\":\"a\",\"name\":\"  Lounge  \",\"channels\":[\"#Second\",\"nope\"],\"collapsed\":false},{\"id\":\"b\",\"name\":\"Other\",\"channels\":[\"#second\",\"#Third\"],\"collapsed\":true}]}")
                in
                Expect.equal
                    [ { id = "a", name = "Lounge", channels = [ "#second" ], collapsed = False }
                    , { id = "b", name = "Other", channels = [ "#third" ], collapsed = True }
                    ]
                    parsed.channelFolders
        , test "a non-object restores the default folder" <|
            \_ ->
                Expect.equal [ ChannelNavigation.defaultFolder ] (ChannelNavigation.parseValue Encode.null).channelFolders
        , test "encode keeps folders, order, and nsfw on the way back" <|
            \_ ->
                let
                    parsed =
                        ChannelNavigation.parseValue
                            (value "{\"starredChannels\":[\"#a\"],\"channelOrder\":[\"#Second\",\"#FIRST\"],\"nsfwChannels\":[\"#night\"],\"channelFolders\":[{\"id\":\"a\",\"name\":\"Lounge\",\"channels\":[\"#second\"],\"collapsed\":false}]}")

                    again =
                        ChannelNavigation.parseValue (value (ChannelNavigation.encode parsed))
                in
                Expect.all
                    [ \_ -> Expect.equal parsed.channelFolders again.channelFolders
                    , \_ -> Expect.equal parsed.channelOrder again.channelOrder
                    , \_ -> Expect.equal parsed.nsfwChannels again.nsfwChannels
                    , \_ -> Expect.equal [ "#a" ] again.starred
                    ]
                    ()
        , test "edits remove and then append without sorting" <|
            \_ ->
                Expect.equal [ "#b", "#c" ]
                    (ChannelNavigation.applyEdits 256 [ "#a" ] [ "#c" ] [ "#b", "#a" ])
        , test "storage keys isolate owners and refuse a blank identity" <|
            \_ ->
                let
                    kai =
                        storageKey "onyx:channel-navigation" { serverUrl = "wss://irc.example/ws", identity = "Kai" }

                    other =
                        storageKey "onyx:channel-navigation" { serverUrl = "wss://irc.example/ws", identity = "mika" }
                in
                Expect.all
                    [ \_ -> Expect.notEqual kai other
                    , \_ -> Expect.notEqual Nothing kai
                    , \_ ->
                        Expect.equal Nothing
                            (storageKey "onyx:channel-navigation" { serverUrl = "wss://irc.example/ws", identity = "" })
                    , \_ ->
                        Expect.equal Nothing
                            (storageKey "onyx:channel-navigation" { serverUrl = " wss://irc.example/ws", identity = "kai" })
                    ]
                    ()
        ]

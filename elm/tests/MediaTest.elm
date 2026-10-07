module MediaTest exposing (suite)

import App exposing (..)
import Dict
import Expect
import Json.Encode as Encode
import Media exposing (..)
import Set
import Test exposing (..)
import Wire


params : List String -> Wire.IrcMessage
params ps =
    { tags = Dict.empty
    , prefix = Nothing
    , nick = Nothing
    , host = Nothing
    , command = "NOTE"
    , params = ps
    , raw = ""
    }


known : Set.Set String
known =
    Set.fromList [ "#c" ]


suite : Test
suite =
    describe "Media control plane"
        [ describe "JOIN / LEAVE"
            [ test "JOIN adds nick lowercased" <|
                \_ ->
                    foldMediaLine blankMediaState known "#&" (params [ "MEDIA", "#c", "JOIN", "Dave" ])
                        |> .participants
                        |> Dict.get "#c"
                        |> Expect.equal (Just [ "dave" ])
            , test "JOIN dedupes case-insensitively" <|
                \_ ->
                    blankMediaState
                        |> (\s -> foldMediaLine s known "#&" (params [ "MEDIA", "#c", "JOIN", "Dave" ]))
                        |> (\s -> foldMediaLine s known "#&" (params [ "MEDIA", "#c", "JOIN", "DAVE" ]))
                        |> .participants
                        |> Dict.get "#c"
                        |> Expect.equal (Just [ "dave" ])
            , test "JOIN to unknown channel allocates nothing" <|
                \_ ->
                    foldMediaLine blankMediaState known "#&" (params [ "MEDIA", "#other", "JOIN", "dave" ])
                        |> .participants
                        |> Dict.isEmpty
                        |> Expect.equal True
            , test "JOIN with invalid actor allocates nothing" <|
                \_ ->
                    foldMediaLine blankMediaState known "#&" (params [ "MEDIA", "#c", "JOIN", "" ])
                        |> .participants
                        |> Dict.isEmpty
                        |> Expect.equal True
            , test "LEAVE removes nick and clears flags" <|
                \_ ->
                    let
                        joined =
                            foldMediaLine blankMediaState known "#&" (params [ "MEDIA", "#c", "JOIN", "dave" ])

                        speaking =
                            foldMediaLine joined known "#&" (params [ "MEDIA", "#c", "SPEAKING", "dave" ])

                        left =
                            foldMediaLine speaking known "#&" (params [ "MEDIA", "#c", "LEAVE", "dave" ])
                    in
                    Expect.all
                        [ \s -> Expect.equal Nothing (Dict.get "#c" s.participants)
                        , \s -> Expect.equal False (Set.member "dave" s.speaking)
                        ]
                        left
            ]
        , describe "SPEAKING / SILENT"
            [ test "SPEAKING ignored for non-rostered nick" <|
                \_ ->
                    foldMediaLine blankMediaState known "#&" (params [ "MEDIA", "#c", "SPEAKING", "mallory" ])
                        |> .speaking
                        |> Set.member "mallory"
                        |> Expect.equal False
            , test "SPEAKING applies to rostered nick" <|
                \_ ->
                    blankMediaState
                        |> (\s -> foldMediaLine s known "#&" (params [ "MEDIA", "#c", "JOIN", "dave" ]))
                        |> (\s -> foldMediaLine s known "#&" (params [ "MEDIA", "#c", "SPEAKING", "dave" ]))
                        |> .speaking
                        |> Set.member "dave"
                        |> Expect.equal True
            , test "SILENT clears unconditionally" <|
                \_ ->
                    blankMediaState
                        |> (\s -> foldMediaLine s known "#&" (params [ "MEDIA", "#c", "JOIN", "dave" ]))
                        |> (\s -> foldMediaLine s known "#&" (params [ "MEDIA", "#c", "SPEAKING", "dave" ]))
                        |> (\s -> foldMediaLine s known "#&" (params [ "MEDIA", "#c", "SILENT", "dave" ]))
                        |> .speaking
                        |> Set.isEmpty
                        |> Expect.equal True
            ]
        , describe "MUTE / HAND"
            [ test "MUTE requires roster membership" <|
                \_ ->
                    foldMediaLine blankMediaState known "#&" (params [ "MEDIA", "#c", "MUTE", "mallory" ])
                        |> .muted
                        |> Set.isEmpty
                        |> Expect.equal True
            , test "MUTE then UNMUTE round-trips" <|
                \_ ->
                    blankMediaState
                        |> (\s -> foldMediaLine s known "#&" (params [ "MEDIA", "#c", "JOIN", "dave" ]))
                        |> (\s -> foldMediaLine s known "#&" (params [ "MEDIA", "#c", "MUTE", "dave" ]))
                        |> (\s -> foldMediaLine s known "#&" (params [ "MEDIA", "#c", "UNMUTE", "dave" ]))
                        |> .muted
                        |> Set.isEmpty
                        |> Expect.equal True
            , test "HAND up/down round-trips" <|
                \_ ->
                    blankMediaState
                        |> (\s -> foldMediaLine s known "#&" (params [ "MEDIA", "#c", "JOIN", "dave" ]))
                        |> (\s -> foldMediaLine s known "#&" (params [ "MEDIA", "#c", "HAND", "dave", "up" ]))
                        |> (\s -> foldMediaLine s known "#&" (params [ "MEDIA", "#c", "HAND", "dave", "down" ]))
                        |> .hands
                        |> Set.isEmpty
                        |> Expect.equal True
            ]
        , describe "REACT"
            [ test "REACT records a rostered emoji" <|
                \_ ->
                    blankMediaState
                        |> (\s -> foldMediaLine s known "#&" (params [ "MEDIA", "#c", "JOIN", "dave" ]))
                        |> (\s -> foldMediaLine s known "#&" (params [ "MEDIA", "#c", "REACT", "dave", "👍" ]))
                        |> .reactions
                        |> Expect.equal [ { channel = "#c", nick = "dave", emoji = "👍" } ]
            , test "REACT ignores strangers and junk emoji" <|
                \_ ->
                    let
                        stranger =
                            foldMediaLine blankMediaState known "#&" (params [ "MEDIA", "#c", "REACT", "mallory", "👍" ])

                        junk =
                            blankMediaState
                                |> (\s -> foldMediaLine s known "#&" (params [ "MEDIA", "#c", "JOIN", "dave" ]))
                                |> (\s -> foldMediaLine s known "#&" (params [ "MEDIA", "#c", "REACT", "dave", "" ]))
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] stranger.reactions
                        , \_ -> Expect.equal [] junk.reactions
                        ]
                        ()
            , test "REACT caps the reaction log" <|
                \_ ->
                    List.range 1 (maxReactionEntries + 5)
                        |> List.foldl
                            (\n s ->
                                foldMediaLine s known "#&" (params [ "MEDIA", "#c", "JOIN", "dave" ])
                                    |> (\j -> foldMediaLine j known "#&" (params [ "MEDIA", "#c", "REACT", "dave", String.fromInt n ]))
                            )
                            blankMediaState
                        |> .reactions
                        |> List.length
                        |> Expect.equal maxReactionEntries
            ]
        , describe "CAPTION / TRANSCRIPT"
            [ test "CAPTION stores nick + text" <|
                \_ ->
                    foldMediaLine blankMediaState known "#&" (params [ "MEDIA", "#c", "CAPTION", "dave", "hello world" ])
                        |> .transcripts
                        |> Dict.get "#c"
                        |> Expect.equal (Just [ { nick = "dave", text = "hello world", time = Nothing } ])
            , test "CAPTION keeps the server time tag" <|
                \_ ->
                    let
                        tagged =
                            params [ "MEDIA", "#c", "CAPTION", "dave", "hello world" ]

                        stamped =
                            { tagged | tags = Dict.singleton "time" "2026-10-06T00:00:00.000Z" }
                    in
                    foldMediaLine blankMediaState known "#&" stamped
                        |> .transcripts
                        |> Dict.get "#c"
                        |> Expect.equal (Just [ { nick = "dave", text = "hello world", time = Just "2026-10-06T00:00:00.000Z" } ])
            , test "TRANSCRIPT alias stores" <|
                \_ ->
                    foldMediaLine blankMediaState known "#&" (params [ "MEDIA", "#c", "TRANSCRIPT", "dave", "spoken words" ])
                        |> .transcripts
                        |> Dict.get "#c"
                        |> Expect.equal (Just [ { nick = "dave", text = "spoken words", time = Nothing } ])
            , test "empty caption text dropped" <|
                \_ ->
                    foldMediaLine blankMediaState known "#&" (params [ "MEDIA", "#c", "CAPTION", "dave" ])
                        |> .transcripts
                        |> Dict.isEmpty
                        |> Expect.equal True
            , test "overlong caption dropped" <|
                \_ ->
                    foldMediaLine blankMediaState known "#&" (params [ "MEDIA", "#c", "CAPTION", "dave", String.repeat 2049 "ab" ])
                        |> .transcripts
                        |> Dict.isEmpty
                        |> Expect.equal True
            , test "transcript capped at newest 200" <|
                \_ ->
                    List.range 1 205
                        |> List.foldl
                            (\i s ->
                                foldMediaLine s known "#&" (params [ "MEDIA", "#c", "CAPTION", "dave", "line " ++ String.fromInt i ])
                            )
                            blankMediaState
                        |> .transcripts
                        |> Dict.get "#c"
                        |> Maybe.map List.length
                        |> Expect.equal (Just 200)
            ]
        , describe "bounds"
            [ test "33rd media channel drops" <|
                \_ ->
                    let
                        chans =
                            List.range 0 32 |> List.map (\i -> "#c" ++ String.fromInt i)

                        knownAll =
                            Set.fromList chans

                        state =
                            List.foldl
                                (\c s -> foldMediaLine s knownAll "#&" (params [ "MEDIA", c, "CAPTION", "d", "hi" ]))
                                blankMediaState
                                chans
                    in
                    state.transcripts
                        |> Dict.size
                        |> Expect.equal 32
            , test "257th participant drops" <|
                \_ ->
                    List.range 0 256
                        |> List.foldl
                            (\i s -> foldMediaLine s known "#&" (params [ "MEDIA", "#c", "JOIN", "u" ++ String.fromInt i ]))
                            blankMediaState
                        |> .participants
                        |> Dict.get "#c"
                        |> Maybe.map List.length
                        |> Expect.equal (Just 256)
            ]
        , describe "builders"
            [ test "mediaJoin voice" <|
                \_ -> mediaJoin "#c" "voice" |> Expect.equal (Just "MEDIA JOIN #c voice\r\n")
            , test "mediaJoin rejects kind" <|
                \_ -> mediaJoin "#c" "hologram" |> Expect.equal Nothing
            , test "mediaLeave" <|
                \_ -> mediaLeave "#c" |> Expect.equal (Just "MEDIA LEAVE #c\r\n")
            , test "mediaOffer includes codecs and webrtc transport" <|
                \_ ->
                    mediaOffer "#c" [ "cadencevox" ] True
                        |> Expect.equal (Just "MEDIA OFFER #c cadencevox transport=webrtc\r\n")
            , test "mediaOffer rejects empty codec list" <|
                \_ -> mediaOffer "#c" [] True |> Expect.equal Nothing
            , test "mediaOffer rejects unknown codec" <|
                \_ -> mediaOffer "#c" [ "mp3" ] False |> Expect.equal Nothing
            , test "mediaBreakout strips sigil like the oracle" <|
                \_ ->
                    mediaBreakout "#&" "#main" "#room" |> Expect.equal (Just "MEDIA BREAKOUT #main room\r\n")
            , test "mediaBreakout bare target passes through" <|
                \_ ->
                    mediaBreakout "#&" "#main" "room" |> Expect.equal (Just "MEDIA BREAKOUT #main room\r\n")
            , test "mediaMute voice mutes and unmutes" <|
                \_ ->
                    Expect.equal
                        ( Just "MEDIA MUTE #c voice\r\n", Just "MEDIA UNMUTE #c voice\r\n" )
                        ( mediaMute "#c" "voice" True, mediaMute "#c" "voice" False )
            , test "mediaMute video is the camera-off verb" <|
                \_ -> mediaMute "#c" "video" True |> Expect.equal (Just "MEDIA MUTE #c video\r\n")
            , test "mediaMute rejects unknown kinds" <|
                \_ -> mediaMute "#c" "hologram" True |> Expect.equal Nothing
            , test "mediaRoster" <|
                \_ -> mediaRoster "#c" |> Expect.equal (Just "MEDIA ROSTER #c\r\n")
            , test "mediaReact trims and sends" <|
                \_ -> mediaReact "#c" "  ✋ " |> Expect.equal (Just "MEDIA REACT #c ✋\r\n")
            , test "mediaReact rejects empty emoji" <|
                \_ -> mediaReact "#c" "   " |> Expect.equal Nothing
            ]
        , describe "calls hub"
            [ test "classifier maps every lifecycle edge truthfully" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal HubIdle (classifyHubPresentation Idle Nothing)
                        , \_ -> Expect.equal HubRingingIn (classifyHubPresentation RingingIn Nothing)
                        , \_ -> Expect.equal HubRingingOut (classifyHubPresentation RingingOut Nothing)
                        , \_ -> Expect.equal HubProvisional (classifyHubPresentation InCall Nothing)
                        , \_ -> Expect.equal HubEstablished (classifyHubPresentation InCall (Just 1700000000000))
                        , \_ -> Expect.equal HubRingingIn (classifyHubPresentation RingingIn (Just 1700000000000))
                        , \_ -> Expect.equal HubRingingOut (classifyHubPresentation RingingOut (Just 1700000000000))
                        , \_ -> Expect.equal HubIdle (classifyHubPresentation Idle (Just 1700000000000))
                        ]
                        ()
            , test "outcome copy stays plain and blameless" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "That call ended." (callOutcomeCopy CallEnded).title
                        , \_ -> Expect.equal "Couldn’t start the call." (callOutcomeCopy CallFailed).title
                        , \_ -> Expect.equal "The connection dropped." (callOutcomeCopy CallDropped).title
                        ]
                        ()
            , test "room label prefers the channel, then the peer" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "#room") (hubRoomLabel { blankCallHub | channel = Just "  #room " })
                        , \_ -> Expect.equal (Just "bob") (hubRoomLabel { blankCallHub | channel = Just "  ", withPeer = " bob " })
                        , \_ -> Expect.equal Nothing (hubRoomLabel blankCallHub)
                        ]
                        ()
            ]
        , describe "Engine lifecycle feed"
            [ test "full established snapshot decodes" <|
                \_ ->
                    decodeEngineSnapshot
                        (Encode.object
                            [ ( "state", Encode.string "in_call" )
                            , ( "nick", Encode.string "aoi" )
                            , ( "channel", Encode.string "#reef" )
                            , ( "startedAt", Encode.int 1700000000000 )
                            , ( "outcome", Encode.null )
                            ]
                        )
                        |> Expect.equal
                            (Just
                                { lifecycle = InCall
                                , nick = "aoi"
                                , channel = Just "#reef"
                                , startedAt = Just 1700000000000
                                , outcome = Nothing
                                }
                            )
            , test "unknown or missing lifecycle drops the snapshot" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal Nothing
                                (decodeEngineSnapshot (Encode.object [ ( "state", Encode.string "on_hold" ) ]))
                        , \_ ->
                            Expect.equal Nothing
                                (decodeEngineSnapshot (Encode.object [ ( "nick", Encode.string "aoi" ) ]))
                        , \_ ->
                            Expect.equal Nothing
                                (decodeEngineSnapshot (Encode.string "in_call"))
                        ]
                        ()
            , test "unknown outcome degrades to Nothing" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            decodeEngineSnapshot
                                (Encode.object
                                    [ ( "state", Encode.string "idle" )
                                    , ( "outcome", Encode.string "declined" )
                                    ]
                                )
                                |> Maybe.map .outcome
                                |> Expect.equal (Just Nothing)
                        , \_ ->
                            decodeEngineSnapshot
                                (Encode.object
                                    [ ( "state", Encode.string "idle" )
                                    , ( "outcome", Encode.string "failed" )
                                    ]
                                )
                                |> Maybe.map .outcome
                                |> Expect.equal (Just (Just CallFailed))
                        ]
                        ()
            , test "corrupt startedAt degrades to provisional" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            decodeEngineSnapshot
                                (Encode.object
                                    [ ( "state", Encode.string "in_call" )
                                    , ( "startedAt", Encode.int -5 )
                                    ]
                                )
                                |> Maybe.map .startedAt
                                |> Expect.equal (Just Nothing)
                        , \_ ->
                            decodeEngineSnapshot
                                (Encode.object
                                    [ ( "state", Encode.string "in_call" )
                                    , ( "startedAt", Encode.float 9007199254740992 )
                                    ]
                                )
                                |> Maybe.map .startedAt
                                |> Expect.equal (Just Nothing)
                        , \_ ->
                            decodeEngineSnapshot
                                (Encode.object
                                    [ ( "state", Encode.string "in_call" )
                                    , ( "startedAt", Encode.float 12.5 )
                                    ]
                                )
                                |> Maybe.map .startedAt
                                |> Expect.equal (Just Nothing)
                        ]
                        ()
            , test "engine nick and channel follow the oracle bounds" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal False (validEngineNick "")
                        , \_ -> Expect.equal False (validEngineNick ":led")
                        , \_ -> Expect.equal False (validEngineNick "a,b")
                        , \_ -> Expect.equal False (validEngineNick "a b")
                        , \_ -> Expect.equal False (validEngineNick (String.repeat 257 "a"))
                        , \_ -> Expect.equal True (validEngineNick "aoi")
                        , \_ -> Expect.equal True (validEngineChannel "#reef")
                        , \_ -> Expect.equal True (validEngineChannel "&deep")
                        , \_ -> Expect.equal False (validEngineChannel "reef")
                        , \_ -> Expect.equal False (validEngineChannel "#a,b")
                        , \_ -> Expect.equal False (validEngineChannel "")
                        , \_ -> Expect.equal False (validEngineChannel ("#" ++ String.repeat 513 "a"))
                        ]
                        ()
            , test "idle tears the hub down but keeps the outcome" <|
                \_ ->
                    let
                        live =
                            { blankCallHub
                                | lifecycle = InCall
                                , channel = Just "#reef"
                                , withPeer = "aoi"
                                , startedAt = Just 1700000000000
                            }
                    in
                    applyEngineSnapshot live
                        { lifecycle = Idle, nick = "", channel = Nothing, startedAt = Nothing, outcome = Just CallEnded }
                        |> Expect.equal { blankCallHub | outcome = Just CallEnded }
            , test "null or hostile channel never wipes the room" <|
                \_ ->
                    let
                        live =
                            { blankCallHub | lifecycle = InCall, channel = Just "#reef" }
                    in
                    Expect.all
                        [ \_ ->
                            applyEngineSnapshot live
                                { lifecycle = InCall, nick = "", channel = Nothing, startedAt = Nothing, outcome = Nothing }
                                |> .channel
                                |> Expect.equal (Just "#reef")
                        , \_ ->
                            applyEngineSnapshot live
                                { lifecycle = InCall, nick = "", channel = Just "reef", startedAt = Nothing, outcome = Nothing }
                                |> .channel
                                |> Expect.equal (Just "#reef")
                        , \_ ->
                            applyEngineSnapshot live
                                { lifecycle = InCall, nick = ":led", channel = Just "#tide", startedAt = Nothing, outcome = Nothing }
                                |> Expect.all
                                    [ \hub -> Expect.equal "" hub.withPeer
                                    , \hub -> Expect.equal (Just "#tide") hub.channel
                                    ]
                        ]
                        ()
            , test "a live snapshot always clears the outcome" <|
                \_ ->
                    applyEngineSnapshot { blankCallHub | outcome = Just CallEnded }
                        { lifecycle = RingingIn, nick = "aoi", channel = Just "#reef", startedAt = Nothing, outcome = Just CallEnded }
                        |> .outcome
                        |> Expect.equal Nothing
            , test "CallHubSnapshot fold applies validated snapshots" <|
                \_ ->
                    let
                        ( next, outbounds ) =
                            update
                                (CallHubSnapshot
                                    (Encode.object
                                        [ ( "state", Encode.string "in_call" )
                                        , ( "nick", Encode.string "aoi" )
                                        , ( "channel", Encode.string "#reef" )
                                        , ( "startedAt", Encode.int 1700000000000 )
                                        ]
                                    )
                                )
                                blank
                    in
                    Expect.all
                        [ \_ -> Expect.equal InCall next.calls.lifecycle
                        , \_ -> Expect.equal (Just "#reef") next.calls.channel
                        , \_ -> Expect.equal "aoi" next.calls.withPeer
                        , \_ -> Expect.equal (Just 1700000000000) next.calls.startedAt
                        , \_ -> Expect.equal [] outbounds
                        ]
                        ()
            , test "CallHubSnapshot fold drops garbage without touching state" <|
                \_ ->
                    let
                        ( next, outbounds ) =
                            update (CallHubSnapshot (Encode.string "in_call")) blank
                    in
                    Expect.all
                        [ \_ -> Expect.equal blankCallHub next.calls
                        , \_ -> Expect.equal [] outbounds
                        ]
                        ()
            , test "CallJoin emits the voice join when live" <|
                \_ ->
                    let
                        ( joined, outs ) =
                            update (CallJoin { channel = "#reef", video = True }) blank

                        ( _, offlineOuts ) =
                            update (CallJoin { channel = "#reef", video = False }) { blank | connection = Offline }

                        ( _, emptyOuts ) =
                            update (CallJoin { channel = "", video = False }) blank
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ VoiceJoin { channel = "#reef", video = True } ] outs
                        , \_ -> Expect.equal False joined.callSelfMuted
                        , \_ -> Expect.equal [] offlineOuts
                        , \_ -> Expect.equal [] emptyOuts
                        ]
                        ()
            , test "CallJoin from a live call leaves first" <|
                \_ ->
                    let
                        busy =
                            { blank | calls = { blankCallHub | lifecycle = InCall, channel = Just "#a" } }

                        ( joined, outs ) =
                            update (CallJoin { channel = "#b", video = False }) busy
                    in
                    Expect.equal [ VoiceLeave { channel = "#a" }, VoiceJoin { channel = "#b", video = False } ] outs
            , test "CallLeave no-ops when idle and leaves when live" <|
                \_ ->
                    let
                        ( _, idleOuts ) =
                            update CallLeave blank

                        busy =
                            { blank | calls = { blankCallHub | lifecycle = InCall, channel = Just "#a" }, callSelfMuted = True }

                        ( left, leftOuts ) =
                            update CallLeave busy
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] idleOuts
                        , \_ -> Expect.equal [ VoiceLeave { channel = "#a" } ] leftOuts
                        , \_ -> Expect.equal False left.callSelfMuted
                        ]
                        ()
            , test "CallToggleMute flips the flag and tells the engine" <|
                \_ ->
                    let
                        ( muted, muteOuts ) =
                            update CallToggleMute blank

                        ( unmuted, unmuteOuts ) =
                            update CallToggleMute muted

                        idleSnap =
                            Encode.object [ ( "state", Encode.string "idle" ) ]

                        ( cleared, _ ) =
                            update (CallHubSnapshot idleSnap) muted
                    in
                    Expect.all
                        [ \_ -> Expect.equal True muted.callSelfMuted
                        , \_ -> Expect.equal [ VoiceMute { muted = True } ] muteOuts
                        , \_ -> Expect.equal False unmuted.callSelfMuted
                        , \_ -> Expect.equal [ VoiceMute { muted = False } ] unmuteOuts
                        , \_ -> Expect.equal False cleared.callSelfMuted
                        ]
                        ()
            ]
        ]

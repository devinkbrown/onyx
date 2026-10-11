module GapAccountTest exposing (suite)

{-| v3/gap-account — wire-line and reply vectors for the account
protection verbs (ACCOUNTSET secure/enforce, RECOVER / RELEASE,
RECOGNIZE, GROUP), the scoped-lists port payloads, and the alert bookkeeping.
Reply texts are the ones the Onyx Server daemon emits
(`src/daemon/server.zig`: handleAccountSet / handleRecover / handleRelease).
-}

import Dict
import Expect
import GapAccount exposing (..)
import Json.Decode as Decode
import Json.Encode as Encode
import Services
import Test exposing (Test, describe, test)
import Wire


server : String -> String
server body =
    ":onyx.example " ++ body


classify : String -> Maybe Reply
classify raw =
    classifyReply (Wire.parseIrcMessage raw)


suite : Test
suite =
    describe "GapAccount"
        [ describe "ACCOUNTSET wire lines"
            [ test "secure on/off" <|
                \_ ->
                    Expect.equal
                        [ Just "ACCOUNTSET kai hunter22 secure on\r\n", Just "ACCOUNTSET kai hunter22 secure off\r\n" ]
                        [ Services.accountSet "kai" "hunter22" "secure" "on"
                        , Services.accountSet "kai" "hunter22" "secure" "off"
                        ]
            , test "enforce on/off" <|
                \_ ->
                    Expect.equal
                        [ Just "ACCOUNTSET kai hunter22 enforce on\r\n", Just "ACCOUNTSET kai hunter22 enforce off\r\n" ]
                        [ Services.accountSet "kai" "hunter22" "enforce" "on"
                        , Services.accountSet "kai" "hunter22" "enforce" "off"
                        ]
            , test "a password that cannot ride one wire token is refused, never truncated" <|
                \_ ->
                    Expect.equal [ Nothing, Nothing, Nothing ]
                        [ Services.accountSet "kai" "has space" "secure" "on"
                        , Services.accountSet "kai" "line\u{000D}\u{000A}QUIT" "secure" "on"
                        , Services.accountSet "kai" "" "secure" "on"
                        ]
            ]
        , describe "RECOVER / RELEASE wire lines (no password: identified owners only)"
            [ test "plain nick" <|
                \_ ->
                    Expect.equal [ Just "RECOVER kai\r\n", Just "RELEASE kai\r\n" ]
                        [ Services.recover "kai", Services.releaseNick "kai" ]
            , test "injection through the nick is refused" <|
                \_ ->
                    Expect.equal [ Nothing, Nothing ]
                        [ Services.recover "kai\u{000D}\u{000A}PRIVMSG x :y", Services.recover "a b" ]
            , test "nick token validation" <|
                \_ ->
                    Expect.equal [ True, False, False, False, False, False ]
                        [ isValidNickToken "kai"
                        , isValidNickToken "a b"
                        , isValidNickToken "#room"
                        , isValidNickToken ":x"
                        , isValidNickToken ""
                        , isValidNickToken (String.repeat 65 "a")
                        ]
            ]
        , describe "RECOGNIZE / GROUP wire lines"
            [ test "recognize list/add/del" <|
                \_ ->
                    Expect.equal
                        [ Just "RECOGNIZE LIST\r\n", Just "RECOGNIZE ADD kai!*@home.example\r\n", Just "RECOGNIZE DEL kai!*@home.example\r\n" ]
                        [ recognizeLine "LIST" Nothing
                        , recognizeLine "ADD" (Just " kai!*@home.example ")
                        , recognizeLine "DEL" (Just "kai!*@home.example")
                        ]
            , test "recognize refuses spaces, controls, empties and unknown verbs" <|
                \_ ->
                    Expect.equal [ Nothing, Nothing, Nothing, Nothing, Nothing ]
                        [ recognizeLine "ADD" (Just "a b")
                        , recognizeLine "ADD" (Just "a\u{000D}b")
                        , recognizeLine "ADD" (Just "")
                        , recognizeLine "NUKE" (Just "x")
                        , recognizeLine "ADD" Nothing
                        ]
            , test "group list/add/del/primary" <|
                \_ ->
                    Expect.equal
                        [ Just "GROUP LIST\r\n", Just "GROUP ADD kai-away\r\n", Just "GROUP DEL kai-away\r\n", Just "GROUP PRIMARY kai-away\r\n" ]
                        [ groupLine "LIST" Nothing
                        , groupLine "ADD" (Just "kai-away")
                        , groupLine "DEL" (Just "kai-away")
                        , groupLine "PRIMARY" (Just "kai-away")
                        ]
            , test "group refuses channels, spaces and comma lists" <|
                \_ ->
                    Expect.equal [ Nothing, Nothing, Nothing ]
                        [ groupLine "ADD" (Just "#room"), groupLine "ADD" (Just "a b"), groupLine "ADD" (Just "a,b") ]
            , test "mask validation" <|
                \_ ->
                    Expect.equal [ True, False, False, False ]
                        [ isValidMask "nick!user@host", isValidMask "a b", isValidMask ":x", isValidMask (String.repeat 256 "a") ]
            ]
        , describe "protection state from ACCOUNTINFO"
            [ test "flags: bit 16 is secure, bit 8 is enforce OFF" <|
                \_ ->
                    Expect.equal
                        [ { secure = Just False, enforce = Just True }
                        , { secure = Just True, enforce = Just True }
                        , { secure = Just False, enforce = Just False }
                        , { secure = Just True, enforce = Just False }
                        ]
                        (List.map (\f -> protectionState { flags = Just f, secure = Nothing, enforce = Nothing }) [ 0, 16, 8, 24 ])
            , test "explicit fields win over flags" <|
                \_ ->
                    Expect.equal { secure = Just False, enforce = Just True }
                        (protectionState { flags = Just 16, secure = Just False, enforce = Just True })
            , test "unknown stays unknown (the switch renders as not-known, never a lie)" <|
                \_ ->
                    Expect.equal { secure = Nothing, enforce = Nothing }
                        (protectionState { flags = Nothing, secure = Nothing, enforce = Nothing })
            ]
        , describe "classifyReply: protection"
            [ test "update notices for secure and enforce" <|
                \_ ->
                    Expect.equal [ Just (ProtectSaved "secure"), Just (ProtectSaved "enforce") ]
                        [ classify (server "NOTICE kai :Account kai updated (secure)")
                        , classify (server "NOTICE kai :Account kai updated (enforce)")
                        ]
            , test "an email update notice is not a protection reply" <|
                \_ -> Expect.equal Nothing (classify (server "NOTICE kai :Account kai updated (email)"))
            , test "464 is a wrong password" <|
                \_ -> Expect.equal (Just ProtectWrongPassword) (classify (server "464 kai :Password incorrect"))
            , test "FAIL ACCOUNTSET carries human copy" <|
                \_ ->
                    Expect.equal
                        [ Just (ProtectFailed "The server rejected that setting.")
                        , Just (ProtectFailed "This server doesn't support that setting.")
                        , Just (ProtectFailed "Accounts are unavailable right now. Try again later.")
                        ]
                        [ classify (server "FAIL ACCOUNTSET INVALID_VALUE :secure must be on or off")
                        , classify (server "FAIL ACCOUNTSET INVALID_FIELD :Unknown field")
                        , classify (server "FAIL ACCOUNTSET TEMPORARILY_UNAVAILABLE :Accounts are unavailable")
                        ]
            , test "a USER forging the notice can never flip protection state" <|
                \_ ->
                    Expect.equal [ Nothing, Nothing, Nothing ]
                        [ classify ":mallory!m@evil NOTICE kai :Account kai updated (secure)"
                        , classify ":mallory!m@evil 464 kai :Password incorrect"
                        , classify ":mallory!m@evil NOTICE kai :RECOVER: forced the holder off kai; reclaim it now"
                        ]
            ]
        , describe "classifyReply: recover / release"
            [ test "recover forced the holder off" <|
                \_ ->
                    Expect.equal
                        (Just (RecoverNotice { verb = "RECOVER", nick = Just "kai", ok = True, text = "Done — the name is free for you now." }))
                        (classify (server "NOTICE kai :RECOVER: forced the holder off kai; reclaim it now"))
            , test "recover with nobody holding" <|
                \_ ->
                    Expect.equal
                        (Just (RecoverNotice { verb = "RECOVER", nick = Nothing, ok = True, text = "Nobody else is using that name." }))
                        (classify (server "NOTICE kai :RECOVER: nobody else is holding that nick"))
            , test "release dropped the hold" <|
                \_ ->
                    Expect.equal
                        (Just (RecoverNotice { verb = "RELEASE", nick = Just "kai", ok = True, text = "Released — the server is no longer holding that name." }))
                        (classify (server "NOTICE kai :RELEASE: dropped the server hold on kai"))
            , test "release with no hold" <|
                \_ ->
                    Expect.equal
                        (Just (RecoverNotice { verb = "RELEASE", nick = Nothing, ok = True, text = "The server isn't holding that name." }))
                        (classify (server "NOTICE kai :RELEASE: there is no server hold on that nick"))
            , test "FAIL codes map to plain copy" <|
                \_ ->
                    Expect.equal
                        [ Just (RecoverFailed { verb = "RECOVER", code = "NICK_NOT_REGISTERED", text = "That name isn't registered." })
                        , Just (RecoverFailed { verb = "RELEASE", code = "ACCESS_DENIED", text = "Sign in to the account that owns that name first." })
                        ]
                        [ classify (server "FAIL RECOVER NICK_NOT_REGISTERED :That nick is not registered")
                        , classify (server "FAIL RELEASE ACCESS_DENIED :You must be identified")
                        ]
            , test "an unfamiliar notice body is kept verbatim but marked not-ok" <|
                \_ ->
                    Expect.equal
                        (Just (RecoverNotice { verb = "RECOVER", nick = Nothing, ok = False, text = "something new" }))
                        (classify (server "NOTICE kai :RECOVER: something new"))
            ]
        , describe "classifyReply: recognition and group lists"
            [ test "recognize rows, empty marker and results" <|
                \_ ->
                    Expect.equal
                        [ Just (RecognizeRow "kai!*@home.example")
                        , Just RecognizeEmpty
                        , Just (RecognizeResult { mask = "kai!*@x", ok = True, text = "added" })
                        , Just (RecognizeResult { mask = "kai!*@x", ok = True, text = "removed" })
                        , Just (RecognizeResult { mask = "bad", ok = False, text = "invalid_mask" })
                        ]
                        [ classify (server "NOTICE kai :Recognize: kai!*@home.example")
                        , classify (server "NOTICE kai :Recognition list for kai is empty")
                        , classify (server "NOTICE kai :Recognize kai!*@x: added")
                        , classify (server "NOTICE kai :Recognize kai!*@x: removed")
                        , classify (server "NOTICE kai :Recognize bad: invalid_mask")
                        ]
            , test "481 on RECOGNIZE is a denial" <|
                \_ ->
                    Expect.equal (Just (RecognizeDenied "Permission Denied"))
                        (classify (server "481 kai RECOGNIZE :Permission Denied"))
            , test "group rows, end marker and results" <|
                \_ ->
                    Expect.equal
                        [ Just (GroupRow { nick = "kai", primary = True })
                        , Just (GroupRow { nick = "kai-away", primary = False })
                        , Just GroupEnd
                        , Just (GroupResult { ok = True, text = "Name added to your group." })
                        , Just (GroupResult { ok = True, text = "Name removed from your group." })
                        , Just (GroupResult { ok = True, text = "Primary name set." })
                        , Just (GroupResult { ok = False, text = "That name isn't in your group." })
                        ]
                        [ classify (server "NOTICE kai :GROUP kai (primary)")
                        , classify (server "NOTICE kai :GROUP kai-away")
                        , classify (server "NOTICE kai :GROUP: end of list")
                        , classify (server "NOTICE kai :GROUP nick added")
                        , classify (server "NOTICE kai :GROUP nick removed")
                        , classify (server "NOTICE kai :GROUP primary set")
                        , classify (server "NOTICE kai :GROUP: no such grouped nick")
                        ]
            , test "FAIL GROUP ACCOUNT_REQUIRED" <|
                \_ ->
                    Expect.equal (Just (GroupFailed "Sign in to manage this."))
                        (classify (server "FAIL GROUP ACCOUNT_REQUIRED :login required"))
            , test "ordinary chatter is ignored" <|
                \_ ->
                    Expect.equal [ Nothing, Nothing ]
                        [ classify (server "NOTICE kai :Welcome to the network")
                        , classify ":mara!m@h PRIVMSG #lounge :GROUP kai"
                        ]
            , test "the pre-filter lets the service lines through and skips chatter" <|
                \_ ->
                    Expect.equal [ True, True, True, False ]
                        [ replyLooksRelevant (server "NOTICE kai :Account kai updated (secure)")
                        , replyLooksRelevant (server "NOTICE kai :GROUP: end of list")
                        , replyLooksRelevant (server "464 kai :Password incorrect")
                        , replyLooksRelevant ":mara!m@h PRIVMSG #lounge :hello"
                        ]
            , test "upsertGroupNick replaces by case-insensitive name and bounds the list" <|
                \_ ->
                    let
                        rows =
                            upsertGroupNick { nick = "KAI", primary = True } [ { nick = "kai", primary = False } ]

                        full =
                            List.range 1 maxGroupNicks |> List.map (\i -> { nick = "n" ++ String.fromInt i, primary = False })
                    in
                    Expect.equal ( [ { nick = "KAI", primary = True } ], maxGroupNicks )
                        ( rows, List.length (upsertGroupNick { nick = "overflow", primary = False } full) )
            ]
        , describe "scoped list payloads"
            [ test "decodeLoaded reads every list" <|
                \_ ->
                    let
                        value =
                            Encode.object
                                [ ( "scope", Encode.string "[\"onyx\",\"guest\"]" )
                                , ( "ignored", Encode.list Encode.string [ "a", "b" ] )
                                , ( "muted", Encode.list Encode.string [ "c" ] )
                                , ( "highlights", Encode.list Encode.string [ "kw" ] )
                                , ( "notify"
                                  , Encode.list identity
                                        [ Encode.object [ ( "channel", Encode.string "#r" ), ( "level", Encode.string "none" ) ] ]
                                  )
                                ]
                    in
                    Expect.equal
                        (Just
                            { scope = "[\"onyx\",\"guest\"]"
                            , ignored = [ "a", "b" ]
                            , muted = [ "c" ]
                            , highlights = [ "kw" ]
                            , notify = [ { channel = "#r", level = "none" } ]
                            }
                        )
                        (decodeLoaded value)
            , test "malformed members read as absent, not as a crash" <|
                \_ ->
                    let
                        value =
                            Encode.object
                                [ ( "scope", Encode.string "s" )
                                , ( "ignored", Encode.list identity [ Encode.string "ok", Encode.int 3, Encode.null ] )
                                , ( "notify", Encode.list identity [ Encode.string "nope", Encode.object [ ( "channel", Encode.string "#r" ) ] ] )
                                ]
                    in
                    Expect.equal (Just ( [ "ok" ], [] ))
                        (decodeLoaded value |> Maybe.map (\l -> ( l.ignored, l.notify |> List.map .channel )))
            , test "an answer with no scope is rejected" <|
                \_ ->
                    Expect.equal Nothing
                        (decodeLoaded (Encode.object [ ( "ignored", Encode.list Encode.string [ "a" ] ) ]))
            , test "an empty scope is rejected" <|
                \_ ->
                    Expect.equal Nothing (decodeLoaded (Encode.object [ ( "scope", Encode.string "" ) ]))
            , test "encodeLists writes only the lists that changed" <|
                \_ ->
                    Expect.equal "{\"ignored\":[\"a\"],\"notify\":[{\"channel\":\"#r\",\"level\":\"none\"}]}"
                        (Encode.encode 0
                            (encodeLists
                                { ignored = Just [ "a" ]
                                , muted = Nothing
                                , highlights = Nothing
                                , notify = Just [ ( "#r", "none" ) ]
                                }
                            )
                        )
            , test "encodeLists of an emptied list writes [] (so a removed block never re-seeds)" <|
                \_ ->
                    Expect.equal "{\"ignored\":[]}"
                        (Encode.encode 0 (encodeLists { ignored = Just [], muted = Nothing, highlights = Nothing, notify = Nothing }))
            , test "round trip through JSON text" <|
                \_ ->
                    let
                        text =
                            Encode.encode 0
                                (Encode.object
                                    [ ( "scope", Encode.string "s" )
                                    , ( "ignored", Encode.list Encode.string [ "x" ] )
                                    ]
                                )
                    in
                    Expect.equal (Just [ "x" ])
                        (Decode.decodeString Decode.value text
                            |> Result.toMaybe
                            |> Maybe.andThen decodeLoaded
                            |> Maybe.map .ignored
                        )
            ]
        , test "saved-search label pluralizes" <|
            \_ ->
                Expect.equal [ "0 saved searches", "1 saved search", "2 saved searches" ]
                    (List.map savedSearchLabel [ 0, 1, 2 ])
        , describe "alert bookkeeping"
            [ test "an alert tag remembers the scope that raised it" <|
                \_ ->
                    Expect.equal (Just "[\"onyx\",\"guest\"]")
                        (Dict.get "onyx-#lounge" (rememberAlertTag "onyx-#lounge" "[\"onyx\",\"guest\"]" blank).alertTags)
            , test "the tag table is bounded (oldest dropped)" <|
                \_ ->
                    let
                        filled =
                            List.range 1 (maxAlertTags + 10)
                                |> List.foldl (\i st -> rememberAlertTag ("t" ++ String.fromInt i) "o" st) blank
                    in
                    Expect.equal ( maxAlertTags, False, True )
                        ( Dict.size filled.alertTags
                        , Dict.member "t1" filled.alertTags
                        , Dict.member ("t" ++ String.fromInt (maxAlertTags + 10)) filled.alertTags
                        )
            , test "re-raising a tag refreshes it instead of duplicating" <|
                \_ ->
                    let
                        st =
                            blank |> rememberAlertTag "a" "o" |> rememberAlertTag "b" "o" |> rememberAlertTag "a" "o2"
                    in
                    Expect.equal ( [ "b", "a" ], Just "o2" ) ( st.alertTagOrder, Dict.get "a" st.alertTags )
            , test "a coalesced alert says how many" <|
                \_ ->
                    let
                        alert n =
                            { title = "kai mentioned you in #lounge", label = "#lounge", body = "hi", private = False, count = n, sender = "kai", isDm = False, queuedAt = 0 }
                    in
                    Expect.equal [ "kai mentioned you in #lounge", "5 new alerts in #lounge" ]
                        [ coalescedTitle (alert 1), coalescedTitle (alert 5) ]
            ]
        ]

module GapConvoTest exposing (suite)

{-| v3/gap-convo — conversation gaps closed, pinned with real wire
vectors where the protocol is involved.

The edit vectors are the exact onyx-server fan-out shape
(`server.zig` `handleEdit` + `buildTagPrefix`: time, account, msgid,
then the relayed client tags):

    @time=…;account=alice;msgid=<orig>;+draft/edit=<orig>;+draft/revision=1 :alice!u@h PRIVMSG #c :<new text>

-}

import App exposing (..)
import Dict
import Expect
import GapConvo
import Html.Attributes
import Json.Encode as Encode
import Labels
import Set
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View.Thread


feed : Model -> String -> ( Model, List Outbound )
feed model line =
    update (WsLineReceived line) model


feedAll : Model -> List String -> Model
feedAll model lines =
    List.foldl (\l m -> Tuple.first (feed m l)) model lines


live : Model
live =
    Tuple.first (feed { blank | ourNick = "me", caps = [ "message-tags", "draft/message-editing", "chathistory", "labeled-response" ] } ":me!u@h JOIN #c")


rows : String -> Model -> List ChatMessage
rows target m =
    Maybe.withDefault [] (Maybe.map .messages (Dict.get target m.channels))


bodies : String -> Model -> List String
bodies target m =
    List.map .body (rows target m)


original : String
original =
    "@time=2026-10-10T12:00:00.000Z;account=alice;msgid=server1-1480339715754191-21 :alice!u@h PRIVMSG #c :hello wrold"


serverEdit : String
serverEdit =
    "@time=2026-10-10T12:00:05.000Z;account=alice;msgid=server1-1480339715754191-21;+draft/edit=server1-1480339715754191-21;+draft/revision=1 :alice!u@h PRIVMSG #c :hello world"


envelope : String
envelope =
    "ONYXDM1 v1.AAAA.BBBB.CCCC"


sendsLine : String -> Outbound -> Bool
sendsLine fragment o =
    case o of
        SendLine l ->
            String.contains fragment l

        _ ->
            False


outsHave : (Outbound -> Bool) -> List Outbound -> Bool
outsHave =
    List.any


isDraftsSave : Outbound -> Bool
isDraftsSave o =
    case o of
        GapConvoOut (GapConvo.DraftsSave _) ->
            True

        _ ->
            False


draftsSaved : List Outbound -> List Encode.Value
draftsSaved =
    List.filterMap
        (\o ->
            case o of
                GapConvoOut (GapConvo.DraftsSave req) ->
                    Just req.drafts

                _ ->
                    Nothing
        )


owned : Model
owned =
    { blank | endpoint = Just "wss://onyx.test/ws", ourNick = "kai", activeChannel = Just "#c", e2eeDms = False }


loadDrafts : List ( String, String ) -> Model -> Model
loadDrafts pairs model =
    Tuple.first
        (update
            (GapConvoMsg
                (GapConvo.DraftsLoaded
                    (Encode.object
                        [ ( "serverUrl", Encode.string "wss://onyx.test/ws" )
                        , ( "identity", Encode.string "kai" )
                        , ( "drafts", Encode.object (List.map (\( k, v ) -> ( k, Encode.string v )) pairs) )
                        , ( "status", Encode.string "saved" )
                        ]
                    )
                )
            )
            model
        )


suite : Test
suite =
    describe "v3/gap-convo"
        [ describe "server-native edits (+draft/edit)"
            [ test "the server fan-out edits the row in place: one row, new text, edited, revision kept" <|
                \_ ->
                    let
                        after =
                            feedAll live [ original, serverEdit ]

                        row =
                            List.head (rows "#c" after)
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ "hello world" ] (bodies "#c" after)
                        , \_ -> Expect.equal (Just True) (Maybe.map .edited row)
                        , \_ -> Expect.equal [ "hello wrold" ] (List.map .body (revisionsFor after.editHistory "server1-1480339715754191-21"))
                        ]
                        ()
            , test "an edit never bumps unread or raises a notification" <|
                \_ ->
                    let
                        before =
                            feedAll live [ original ]

                        ( after, _ ) =
                            feed before serverEdit
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Maybe.map .unread (Dict.get "#c" before.channels)) (Maybe.map .unread (Dict.get "#c" after.channels))
                        , \_ -> Expect.equal (List.length before.notifications) (List.length after.notifications)
                        ]
                        ()
            , test "a replay of the same edit is idempotent (one revision)" <|
                \_ ->
                    let
                        after =
                            feedAll live [ original, serverEdit, serverEdit ]
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ "hello world" ] (bodies "#c" after)
                        , \_ -> Expect.equal 1 (List.length (revisionsFor after.editHistory "server1-1480339715754191-21"))
                        ]
                        ()
            , test "our own EDIT echo settles on the optimistic row without a duplicate" <|
                \_ ->
                    let
                        mine =
                            feedAll live [ "@msgid=m-own :me!u@h PRIVMSG #c :typo hree" ]

                        ( edited, out ) =
                            requestEdit mine "#c" "m-own" "typo here"

                        echoed =
                            feedAll edited [ "@time=2026-10-10T12:01:00.000Z;msgid=m-own;+draft/edit=m-own;+draft/revision=1 :me!u@h PRIVMSG #c :typo here" ]
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ SendLine "EDIT #c m-own :typo here\u{000D}\n" ] out
                        , \_ -> Expect.equal [ "typo here" ] (bodies "#c" echoed)
                        , \_ -> Expect.equal 1 (List.length (revisionsFor echoed.editHistory "m-own"))
                        ]
                        ()
            , test "a DM edit lands in the peer's conversation" <|
                \_ ->
                    let
                        after =
                            feedAll live
                                [ "@msgid=dm-1 :alice!u@h PRIVMSG me :see you at 5"
                                , "@msgid=dm-1;+draft/edit=dm-1;+draft/revision=1 :alice!u@h PRIVMSG me :see you at 6"
                                ]
                    in
                    Expect.equal [ "see you at 6" ] (bodies "alice" after)
            , test "a client-tagged edit of someone else's row is their own message, never a rewrite" <|
                \_ ->
                    let
                        after =
                            feedAll live
                                [ original
                                , "@msgid=fresh-9;+draft/edit=server1-1480339715754191-21 :mallory!u@h PRIVMSG #c :alice said something rude"
                                ]
                    in
                    Expect.equal [ "alice said something rude", "hello wrold" ] (bodies "#c" after)
            , test "an edit that arrives before its row waits and applies when the row lands" <|
                \_ ->
                    let
                        after =
                            feedAll live
                                [ "@msgid=late-1;+draft/edit=late-1;+draft/revision=1 :alice!u@h PRIVMSG #c :fixed text"
                                , "@batch=h1 :srv BATCH +h1 chathistory #c"
                                , "@batch=h1;time=2026-10-10T11:00:00.000Z;msgid=late-1 :alice!u@h PRIVMSG #c :fixd txt"
                                , ":srv BATCH -h1"
                                ]

                        row =
                            List.head (rows "#c" after)
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ "fixed text" ] (bodies "#c" after)
                        , \_ -> Expect.equal (Just True) (Maybe.map .edited row)
                        , \_ -> Expect.equal Dict.empty after.gapConvo.pendingEdits
                        ]
                        ()
            , test "an edit inside a CHATHISTORY batch folds at the close, after its row" <|
                \_ ->
                    let
                        after =
                            feedAll live
                                [ "@batch=h2 :srv BATCH +h2 chathistory #c"
                                , "@batch=h2;time=2026-10-10T11:00:00.000Z;msgid=b-1 :alice!u@h PRIVMSG #c :frist"
                                , "@batch=h2;time=2026-10-10T11:00:03.000Z;msgid=b-1;+draft/edit=b-1 :alice!u@h PRIVMSG #c :first"
                                , ":srv BATCH -h2"
                                ]
                    in
                    Expect.equal [ "first" ] (bodies "#c" after)
            , test "a replay of a held row with newer text (edited while away) refreshes it" <|
                \_ ->
                    let
                        after =
                            feedAll live
                                [ original
                                , "@batch=h3 :srv BATCH +h3 chathistory #c"
                                , "@batch=h3;time=2026-10-10T12:00:00.000Z;msgid=server1-1480339715754191-21 :alice!u@h PRIVMSG #c :hello world"
                                , ":srv BATCH -h3"
                                ]
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ "hello world" ] (bodies "#c" after)
                        , \_ -> Expect.equal (Just True) (Maybe.map .edited (List.head (rows "#c" after)))
                        ]
                        ()
            , test "an author-mismatched server edit is ignored" <|
                \_ ->
                    let
                        after =
                            feedAll live
                                [ original
                                , "@msgid=server1-1480339715754191-21;+draft/edit=server1-1480339715754191-21 :mallory!u@h PRIVMSG #c :pwned"
                                ]
                    in
                    Expect.equal [ "hello wrold" ] (bodies "#c" after)
            , test "an E2EE row is never rewritten by an edit (plaintext or sealed), and no row is added" <|
                \_ ->
                    let
                        sealed =
                            feedAll { live | e2eeDms = True }
                                [ "@msgid=e-1 :alice!u@h PRIVMSG me :" ++ envelope
                                , "@msgid=e-1;+draft/edit=e-1 :alice!u@h PRIVMSG me :downgraded plaintext"
                                , "@msgid=e-1;+draft/edit=e-1 :alice!u@h PRIVMSG me :ONYXDM1 v1.DDDD.EEEE.FFFF"
                                ]
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ envelope ] (bodies "alice" sealed)
                        , \_ -> Expect.equal (Just False) (Maybe.map .edited (List.head (rows "alice" sealed)))
                        ]
                        ()
            , test "a deleted row stays deleted" <|
                \_ ->
                    let
                        after =
                            feedAll live
                                [ "@msgid=r-1 :alice!u@h PRIVMSG #c :oops"
                                , ":alice!u@h REDACT #c r-1"
                                , "@msgid=r-1;+draft/edit=r-1 :alice!u@h PRIVMSG #c :back from the dead"
                                ]
                    in
                    Expect.equal [ True ] (List.map .redacted (rows "#c" after))
            , test "a CTCP ACTION edit unwraps to its text" <|
                \_ ->
                    Expect.equal "waves" (GapConvo.editBody "\u{0001}ACTION waves\u{0001}")
            , test "edit refs are single wire tokens (fail closed)" <|
                \_ ->
                    Expect.equal [ Just "a-1", Nothing, Nothing, Just "b" ]
                        [ GapConvo.editRefOf (Dict.fromList [ ( "+draft/edit", "a-1" ) ])
                        , GapConvo.editRefOf (Dict.fromList [ ( "+draft/edit", "a b" ) ])
                        , GapConvo.editRefOf (Dict.fromList [ ( "+draft/edit", "" ) ])
                        , GapConvo.editRefOf (Dict.fromList [ ( "draft/edit", "b" ) ])
                        ]
            , test "pending edits are bounded" <|
                \_ ->
                    let
                        stuffed =
                            List.foldl (\n s -> GapConvo.stashEdit (GapConvo.pendingEditKey "#c" (String.fromInt n)) { from = "a", body = "x" } s) GapConvo.blank (List.range 1 (GapConvo.maxPendingEdits + 25))
                    in
                    Expect.equal GapConvo.maxPendingEdits (Dict.size stuffed.pendingEdits)
            ]
        , describe "401 to an offline nick"
            [ test "a labeled DM answered with 401 says Message not delivered and hands the text back" <|
                \_ ->
                    let
                        ( sent, _ ) =
                            update (ComposerInput "are you around?") { blank | ourNick = "alice", caps = [ "labeled-response" ], activeChannel = Just "bob", e2eeDms = False }
                                |> Tuple.first
                                |> update ComposerSend

                        label =
                            Labels.nextClientLabel 0 1

                        ( failed, _ ) =
                            feed sent ("@label=" ++ label ++ " :srv 401 alice bob :No such nick/channel")
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] (bodies "bob" failed)
                        , \_ -> Expect.equal [ "Message not delivered" ] (List.map .title failed.toasts)
                        , \_ -> Expect.equal [ "bob isn't on the network right now, so the message was not sent. Your text is back in the composer." ] (List.filterMap .description failed.toasts)
                        , \_ -> Expect.equal "are you around?" failed.composer
                        ]
                        ()
            , test "a draft typed meanwhile is never overwritten" <|
                \_ ->
                    let
                        ( sent, _ ) =
                            update (ComposerInput "first") { blank | ourNick = "alice", caps = [ "labeled-response" ], activeChannel = Just "bob", e2eeDms = False }
                                |> Tuple.first
                                |> update ComposerSend

                        typing =
                            Tuple.first (update (ComposerInput "second thought") sent)

                        ( failed, _ ) =
                            feed typing ("@label=" ++ Labels.nextClientLabel 0 1 ++ " :srv 401 alice bob :No such nick/channel")
                    in
                    Expect.all
                        [ \_ -> Expect.equal "second thought" failed.composer
                        , \_ -> Expect.equal [ "bob isn't on the network right now, so the message was not sent." ] (List.filterMap .description failed.toasts)
                        ]
                        ()
            ]
        , describe "staged attachments belong to their conversation"
            [ test "switching rooms stashes the files and switching back restores them" <|
                \_ ->
                    let
                        base =
                            feedAll { blank | ourNick = "me" } [ ":me!u@h JOIN #a", ":me!u@h JOIN #b" ]

                        inA =
                            Tuple.first (update (ChannelSelect "#a") base)

                        staged =
                            Tuple.first (update (UploadPicked { key = "att-0", files = [ { name = "a.png", size = 10, mime = "image/png" } ] }) inA)

                        inB =
                            Tuple.first (update (ChannelSelect "#b") staged)

                        backInA =
                            Tuple.first (update (ChannelSelect "#a") inB)
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ "a.png" ] (List.map .name staged.attachments)
                        , \_ -> Expect.equal [] inB.attachments
                        , \_ -> Expect.equal [ "a.png" ] (List.map .name backInA.attachments)
                        , \_ -> Expect.equal Dict.empty backInA.gapConvo.stagedByTarget
                        ]
                        ()
            , test "an upload finishing after you left sends to ITS room and leaves your draft alone" <|
                \_ ->
                    let
                        base =
                            feedAll { blank | ourNick = "me" } [ ":me!u@h JOIN #a", ":me!u@h JOIN #b" ]

                        inA =
                            Tuple.first (update (ChannelSelect "#a") base)

                        staged =
                            Tuple.first (update (UploadPicked { key = "att-0", files = [ { name = "a.png", size = 10, mime = "image/png" } ] }) { inA | composer = "look" })

                        ( sending, _ ) =
                            update ComposerSend staged

                        inB =
                            Tuple.first (update (ChannelSelect "#b") sending)

                        typing =
                            Tuple.first (update (ComposerInput "draft in b") inB)

                        progressed =
                            Tuple.first (update (UploadProgress { key = "att-0", index = 0, loaded = 5, total = Just 10 }) typing)

                        ( done, out ) =
                            update (UploadDone { key = "att-0", index = 0, ok = True, status = 201, body = "{\"path\":\"/uploads/a.png\"}", contentType = Just "application/json" }) progressed
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (List.any (sendsLine "PRIVMSG #a :look") out)
                        , \_ -> Expect.equal False (List.any (sendsLine "PRIVMSG #b") out)
                        , \_ -> Expect.equal "draft in b" done.composer
                        , \_ -> Expect.equal [] done.attachments
                        , \_ -> Expect.equal Dict.empty done.gapConvo.stagedByTarget
                        , \_ -> Expect.equal [ Just 50 ] (List.map .progress (Maybe.withDefault [] (Dict.get "#a" progressed.gapConvo.stagedByTarget)))
                        ]
                        ()
            ]
        , describe "drafts on this device"
            [ test "stored drafts restore into the empty composer and the per-room map" <|
                \_ ->
                    let
                        loaded =
                            loadDrafts [ ( "#c", "half a thought" ), ( "#d", "other room" ) ] owned
                    in
                    Expect.all
                        [ \_ -> Expect.equal "half a thought" loaded.composer
                        , \_ -> Expect.equal (Just "other room") (Dict.get "#d" loaded.composerDrafts)
                        , \_ -> Expect.equal True loaded.gapConvo.draftsLoaded
                        ]
                        ()
            , test "typing persists the owner's snapshot (nothing before the load)" <|
                \_ ->
                    let
                        ( _, before ) =
                            update (ComposerInput "early") owned

                        loaded =
                            loadDrafts [] owned

                        ( _, after ) =
                            update (ComposerInput "keep me") loaded
                    in
                    Expect.all
                        [ \_ -> Expect.equal False (outsHave isDraftsSave before)
                        , \_ -> Expect.equal [ Encode.encode 0 (Encode.object [ ( "#c", Encode.string "keep me" ) ]) ] (List.map (Encode.encode 0) (draftsSaved after))
                        ]
                        ()
            , test "slash commands and encrypted DMs never persist" <|
                \_ ->
                    let
                        loaded =
                            loadDrafts [] { owned | e2eeDms = True, composerDrafts = Dict.fromList [ ( "bob", "secret plan" ) ] }

                        ( slashed, slashOut ) =
                            update (ComposerInput "/identify hunter2") loaded

                        ( _, plainOut ) =
                            update (ComposerInput "hello") slashed
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] (draftsSaved slashOut)
                        , \_ -> Expect.equal [ Encode.encode 0 (Encode.object [ ( "#c", Encode.string "hello" ) ]) ] (List.map (Encode.encode 0) (draftsSaved plainOut))
                        ]
                        ()
            , test "a stale owner's drafts are dropped" <|
                \_ ->
                    let
                        stale =
                            Tuple.first
                                (update
                                    (GapConvoMsg
                                        (GapConvo.DraftsLoaded
                                            (Encode.object
                                                [ ( "serverUrl", Encode.string "wss://onyx.test/ws" )
                                                , ( "identity", Encode.string "someone-else" )
                                                , ( "drafts", Encode.object [ ( "#c", Encode.string "not yours" ) ] )
                                                ]
                                            )
                                        )
                                    )
                                    owned
                                )
                    in
                    Expect.equal "" stale.composer
            , test "draft journals are sanitized like the oracle" <|
                \_ ->
                    Expect.equal [ ( "#ok", "x" ) ]
                        (GapConvo.sanitizeDrafts [ ( " #OK ", "x" ), ( "bad key", "y" ), ( "#empty", "" ), ( String.repeat 300 "a", "z" ) ])
            , test "the composer shows where the draft lives" <|
                \_ ->
                    let
                        loaded =
                            loadDrafts [] owned

                        typed =
                            Tuple.first (update (ComposerInput "hello") loaded)

                        saved =
                            Tuple.first (update (GapConvoMsg (GapConvo.DraftsSaved "saved")) typed)
                    in
                    Expect.equal (Just "Saved here") (Maybe.map .text (gapDraftStatus saved))
            ]
        , describe "landing on a message"
            [ test "a search hit scrolls into view without stealing the field's focus" <|
                \_ ->
                    let
                        withRows =
                            feedAll { live | activeChannel = Just "#c" } [ "@msgid=s1 :alice!u@h PRIVMSG #c :needle one", "@msgid=s2 :alice!u@h PRIVMSG #c :hay" ]

                        ( _, out ) =
                            update (SearchQuery { query = "needle" }) { withRows | searchOpen = True }
                    in
                    Expect.equal True (List.member (TranscriptScroll { action = "message-quiet", key = "m:s1" }) out)
            , test "a landing on a hidden sender shows them again" <|
                \_ ->
                    let
                        withRow =
                            feedAll { live | activeChannel = Just "#c" } [ "@msgid=p1 :alice!u@h PRIVMSG #c :pinned" ]

                        ( landed, out ) =
                            update (PinnedMessageJump { channel = "#c", messageId = "p1" }) { withRow | collapsedNicks = Set.fromList [ "alice" ] }
                    in
                    Expect.all
                        [ \_ -> Expect.equal Set.empty landed.collapsedNicks
                        , \_ -> Expect.equal [ TranscriptScroll { action = "message", key = "m:p1" } ] out
                        ]
                        ()
            , test "a ?at= window that closes lands on the row nearest its moment" <|
                \_ ->
                    let
                        withRows =
                            feedAll { live | activeChannel = Just "#c", caps = [ "message-tags", "chathistory" ] }
                                [ "@time=2026-10-10T10:00:00.000Z;msgid=t-1 :alice!u@h PRIVMSG #c :early"
                                , "@time=2026-10-10T12:00:00.000Z;msgid=t-2 :alice!u@h PRIVMSG #c :late"
                                ]

                        -- the 11:50 moment is nearest the 12:00 row
                        travelling =
                            { withRows | pendingTravel = Just { target = "#c", at = 1791633000000 }, historyLoading = Set.fromList [ "#c" ] }

                        ( closed, outs ) =
                            update (WsLineReceived "@batch=ta :srv BATCH +ta chathistory #c") travelling
                                |> (\( m, o ) -> let ( m2, o2 ) = update (WsLineReceived "@batch=ta;time=2026-10-10T11:49:00.000Z;msgid=t-3 :alice!u@h PRIVMSG #c :window") m in ( m2, o ++ o2 ))
                                |> (\( m, o ) -> let ( m2, o2 ) = update (WsLineReceived ":srv BATCH -ta") m in ( m2, o ++ o2 ))
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing closed.pendingTravel
                        , \_ -> Expect.equal True (List.any (\o -> case o of
                                                                    TranscriptScroll { action } ->
                                                                        action == "message"

                                                                    _ ->
                                                                        False
                                                            ) outs)
                        ]
                        ()
            , test "a dropped connection that clears a pending travel lands nowhere" <|
                \_ ->
                    let
                        travelling =
                            { withRows | pendingTravel = Just { target = "#c", at = 1791633000000 } }

                        withRows =
                            feedAll { live | activeChannel = Just "#c" }
                                [ "@time=2026-10-10T10:00:00.000Z;msgid=t-1 :alice!u@h PRIVMSG #c :early"
                                , "@time=2026-10-10T12:00:00.000Z;msgid=t-2 :alice!u@h PRIVMSG #c :late"
                                ]

                        ( dropped, outs ) =
                            update (WsClosed { clean = False, reason = "x" }) travelling
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing dropped.pendingTravel
                        , \_ -> Expect.equal Nothing dropped.gapConvo.landing
                        , \_ -> Expect.equal False (List.any (\o -> case o of
                                                                    TranscriptScroll _ ->
                                                                        True

                                                                    _ ->
                                                                        False
                                                            ) outs)
                        ]
                        ()
            , test "a landing far back pages the window to it" <|
                \_ ->
                    let
                        many =
                            feedAll { live | activeChannel = Just "#c" }
                                (List.map (\n -> "@msgid=n" ++ String.fromInt n ++ " :alice!u@h PRIVMSG #c :line " ++ String.fromInt n) (List.range 1 300))

                        ( landed, _ ) =
                            update (PinnedMessageJump { channel = "#c", messageId = "n5" }) many
                    in
                    Expect.notEqual Nothing landed.threadPageStart
            ]
        , describe "composer focus and small fixes"
            [ test "reply and edit hand focus to the composer" <|
                \_ ->
                    let
                        withRows =
                            feedAll { live | activeChannel = Just "#c" } [ "@msgid=x1 :alice!u@h PRIVMSG #c :hi", "@msgid=x2 :me!u@h PRIVMSG #c :mine" ]

                        ( _, replyOut ) =
                            update (ReplyArm { target = "#c", msgid = "x1" }) withRows

                        ( _, editOut ) =
                            update (EditArm { target = "#c", msgid = "x2" }) withRows
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ PrefsFocus { id = "shell-composer-input" } ] replyOut
                        , \_ -> Expect.equal [ PrefsFocus { id = "shell-composer-input" } ] editOut
                        ]
                        ()
            , test "Ctrl/Cmd+F keeps the draft" <|
                \_ ->
                    Expect.equal "keep" (Tuple.first (update SearchHotkey { blank | composer = "keep", activeChannel = Just "#c" })).composer
            , test "Show all brings every hidden sender back" <|
                \_ ->
                    let
                        withRows =
                            feedAll { live | activeChannel = Just "#c", collapsedNicks = Set.fromList [ "alice", "bob" ] } [ "@msgid=h1 :alice!u@h PRIVMSG #c :hi" ]

                        ( shown, _ ) =
                            update (GapConvoMsg GapConvo.CollapsedShowAll) withRows
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ ( "alice", 1 ) ] (Maybe.withDefault [] (Maybe.map (gapCollapsedIn withRows) (Dict.get "#c" withRows.channels)))
                        , \_ -> Expect.equal Set.empty shown.collapsedNicks
                        ]
                        ()
            ]
        , describe "photo privacy"
            [ test "the bridge's report decodes fail-closed" <|
                \_ ->
                    Expect.equal
                        [ Just "removed", Nothing, Nothing ]
                        [ GapConvo.decodePhotoPrepared (Encode.object [ ( "key", Encode.string "att-0" ), ( "index", Encode.int 0 ), ( "kind", Encode.string "jpeg" ), ( "metadata", Encode.string "removed" ), ( "cleanBytes", Encode.int 900 ) ]) |> Maybe.map (.prep >> .metadata)
                        , GapConvo.decodePhotoPrepared (Encode.object [ ( "key", Encode.string "att-0" ), ( "index", Encode.int 0 ), ( "kind", Encode.string "exe" ), ( "metadata", Encode.string "removed" ) ]) |> Maybe.map (.prep >> .metadata)
                        , GapConvo.decodePhotoPrepared (Encode.object [ ( "key", Encode.string "" ), ( "index", Encode.int 0 ), ( "kind", Encode.string "jpeg" ), ( "metadata", Encode.string "none" ) ]) |> Maybe.map (.prep >> .metadata)
                        ]
            , test "variants: cleaned by default, compact when chosen, original only with consent" <|
                \_ ->
                    let
                        prep =
                            Just { kind = "jpeg", metadata = "removed", cleanBytes = Just 900, compactBytes = Just 300 }
                    in
                    Expect.equal [ "clean", "compact", "original", "clean" ]
                        [ GapConvo.photoUploadVariant prep GapConvo.blankPhotoChoice
                        , GapConvo.photoUploadVariant prep { quality = "compact", keepMetadata = False, refused = False }
                        , GapConvo.photoUploadVariant prep { quality = "compact", keepMetadata = True, refused = False }
                        , GapConvo.photoUploadVariant Nothing { quality = "compact", keepMetadata = False, refused = False }
                        ]
            , test "a refused photo explains itself and only explicit consent re-arms it" <|
                \_ ->
                    let
                        inC =
                            { live | activeChannel = Just "#c", composer = "trip" }

                        staged =
                            Tuple.first (update (UploadPicked { key = "att-0", files = [ { name = "beach.dng", size = 10, mime = "image/x-adobe-dng" } ] }) inC)

                        ( sending, _ ) =
                            update ComposerSend staged

                        refused =
                            Tuple.first (update (GapConvoMsg (GapConvo.PhotoRefused { key = "att-0", index = 0 })) sending)

                        ( failed, _ ) =
                            update (UploadDone { key = "att-0", index = 0, ok = False, status = 0, body = "", contentType = Nothing }) refused

                        ( kept, keptOut ) =
                            update (GapConvoMsg (GapConvo.PhotoKeepMetadata { key = "att-0", index = 0, keep = True })) failed
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just "Couldn't remove location data from beach.dng. Remove it, or choose Send with location data.") failed.composerError
                        , \_ -> Expect.equal [ StagedReady ] (List.map .status kept.attachments)
                        , \_ -> Expect.equal [ GapConvoOut (GapConvo.UploadVariant { key = "att-0", index = 0, variant = "original" }) ] keptOut
                        , \_ -> Expect.equal Nothing kept.composerError
                        ]
                        ()
            ]
        , describe "caret and small copy"
            [ test "insertAtCaret lands at the selection, replaces a selection, and falls back to the end" <|
                \_ ->
                    Expect.equal
                        [ { text = "hello\u{1F600} world", caret = 7 }
                        , { text = "hi \u{1F600}s", caret = 5 }
                        , { text = "hello\u{1F600}", caret = 7 }
                        , { text = "hello\u{1F600}", caret = 7 }
                        , { text = "hello\u{1F600}", caret = 7 }
                        ]
                        [ GapConvo.insertAtCaret (Just { start = 5, end = 5 }) "\u{1F600}" "hello world"
                        , GapConvo.insertAtCaret (Just { start = 3, end = 8 }) "\u{1F600}" "hi worlds"
                        , GapConvo.insertAtCaret Nothing "\u{1F600}" "hello"
                        , GapConvo.insertAtCaret (Just { start = 9, end = 12 }) "\u{1F600}" "hello"
                        , GapConvo.insertAtCaret (Just { start = -1, end = 2 }) "\u{1F600}" "hello"
                        ]
            , test "an emoji pick goes where the caret was and asks the field to put the cursor after it" <|
                \_ ->
                    let
                        typed =
                            { owned | composer = "hello world" }

                        moved =
                            Tuple.first (update (GapConvoMsg (GapConvo.CaretMoved { start = 5, end = 5 })) typed)

                        ( picked, outs ) =
                            update (ComposerEmojiInsert "\u{1F600}") moved
                    in
                    Expect.all
                        [ \_ -> Expect.equal "hello\u{1F600} world" picked.composer
                        , \_ -> Expect.equal [ GapConvoOut (GapConvo.CaretSet { pos = 7 }) ] outs
                        ]
                        ()
            , test "a draft rewritten by anything but typing forgets the caret; typing keeps it" <|
                \_ ->
                    let
                        typed =
                            Tuple.first (update (GapConvoMsg (GapConvo.CaretMoved { start = 2, end = 2 })) { owned | composer = "hi" })

                        stillTyping =
                            Tuple.first (update (ComposerInput "hiy") typed)

                        quoted =
                            Tuple.first (update (MessageQuote { target = "#c", from = "alice", body = "hey" }) typed)
                    in
                    Expect.equal [ Just { start = 2, end = 2 }, Nothing ]
                        [ stillTyping.gapConvo.composerCaret, quoted.gapConvo.composerCaret ]
            , test "the draft line speaks the oracle's words" <|
                \_ ->
                    Expect.equal
                        [ Just ( "Saved here", True )
                        , Just ( "Only on this tab", False )
                        , Just ( "Saved with limits; full text remains here", False )
                        , Just ( "Could not save; full text remains here", False )
                        , Just ( "Only on this tab", False )
                        , Nothing
                        ]
                        (List.map (Maybe.map (\c -> ( c.text, c.saved )))
                            [ GapConvo.draftStatusCopy { persistable = True, status = GapConvo.DraftSaved }
                            , GapConvo.draftStatusCopy { persistable = True, status = GapConvo.DraftTabOnly }
                            , GapConvo.draftStatusCopy { persistable = True, status = GapConvo.DraftLimit }
                            , GapConvo.draftStatusCopy { persistable = True, status = GapConvo.DraftFailed }
                            , GapConvo.draftStatusCopy { persistable = False, status = GapConvo.DraftSaved }
                            , GapConvo.draftStatusCopy { persistable = True, status = GapConvo.DraftUnknown }
                            ]
                        )
            , test "the bridge's status words map to the right state" <|
                \_ ->
                    Expect.equal
                        [ GapConvo.DraftSaved, GapConvo.DraftTabOnly, GapConvo.DraftLimit, GapConvo.DraftFailed, GapConvo.DraftUnknown ]
                        (List.map GapConvo.draftStatusFromString [ "saved", "only-in-tab", "limit-reached", "malformed", "???" ])
            , test "only an empty conversation whose history is in flight shows placeholders" <|
                \_ ->
                    case Dict.get "#c" live.channels of
                        Just ch ->
                            Expect.equal [ False, True ]
                                [ gapHistoryLoadingEmpty { live | historyLoading = Set.empty } ch
                                , gapHistoryLoadingEmpty { live | historyLoading = Set.fromList [ "#c" ] } ch
                                ]

                        Nothing ->
                            Expect.fail "the fixture joined #c"
            , test "quote carries the readable text of an opened encrypted row, never the envelope" <|
                \_ ->
                    let
                        withRow =
                            feedAll { live | activeChannel = Just "#c" } [ "@msgid=x1 :alice!u@h PRIVMSG #c :placeholder" ]

                        sealed =
                            { withRow
                                | channels =
                                    Dict.update "#c"
                                        (Maybe.map (\ch -> { ch | messages = List.map (\m -> { m | body = envelope, plaintext = Just "the opened secret" }) ch.messages }))
                                        withRow.channels
                            }

                        opened =
                            Tuple.first (update (MessageMenuOpen { target = "#c", msgid = "x1" }) sealed)
                    in
                    View.Thread.thread opened
                        |> Query.fromHtml
                        |> Query.find [ Selector.attribute (Html.Attributes.attribute "role" "menuitem"), Selector.containing [ Selector.text "Quote in composer" ] ]
                        |> Event.simulate Event.click
                        |> Event.expect (MessageQuote { target = "#c", from = "alice", body = "the opened secret" })
            ]
        ]

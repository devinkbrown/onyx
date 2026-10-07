module FormationTest exposing (suite)

{-| Vectors for the Start-a-room formation loop, mirroring the oracle
`src/lib/rooms/createRoomFormation.ts` (name normalization, topic and
invitee sanitizers, skin seeds, the topic builder, invitee add/remove with
the 3-person target, the shared-invite finish gate, the share-receipt reset,
and the skin first-line suggestion).
-}

import App exposing (..)
import Expect
import Test exposing (Test, describe, test)


liveModel : Model
liveModel =
    { blank | connection = Live, ourNick = "kai", nowMs = 1000 }


armPending : Model -> String -> String -> String -> Model
armPending model channel topic firstLine =
    { model
        | pendingCreateRoom =
            Just { channel = channel, topic = topic, firstLine = firstLine, dueMs = 16000 }
    }


isTopicLine : Outbound -> Bool
isTopicLine out =
    case out of
        SendLine line ->
            String.startsWith "TOPIC " line

        _ ->
            False


suite : Test
suite =
    describe "room formation"
        [ describe "normalizeCreateRoomName"
            [ test "bare name gains a hash prefix" <|
                \_ -> Expect.equal (Just "#friends") (normalizeCreateRoomName "friends")
            , test "whitespace trims before prefixing" <|
                \_ -> Expect.equal (Just "#book-club") (normalizeCreateRoomName "  book-club  ")
            , test "existing hash prefix is kept" <|
                \_ -> Expect.equal (Just "#friends") (normalizeCreateRoomName "#friends")
            , test "ampersand prefix is kept" <|
                \_ -> Expect.equal (Just "&local") (normalizeCreateRoomName "&local")
            , test "name lowercases" <|
                \_ -> Expect.equal (Just "#friends") (normalizeCreateRoomName "Friends")
            , test "empty is rejected" <|
                \_ -> Expect.equal Nothing (normalizeCreateRoomName "   ")
            , test "spaces inside are rejected" <|
                \_ -> Expect.equal Nothing (normalizeCreateRoomName "my room")
            , test "commas are rejected" <|
                \_ -> Expect.equal Nothing (normalizeCreateRoomName "a,b")
            , test "control characters are rejected" <|
                \_ -> Expect.equal Nothing (normalizeCreateRoomName "a\u{0007}b")
            , test "overlong rest is rejected" <|
                \_ -> Expect.equal Nothing (normalizeCreateRoomName ("#" ++ String.repeat 64 "a"))
            , test "63-char rest is the boundary accept" <|
                \_ -> Expect.equal (Just ("#" ++ String.repeat 63 "a")) (normalizeCreateRoomName (String.repeat 63 "a"))
            ]
        , describe "sanitizeCreateRoomTopic"
            [ test "empty trims to empty" <|
                \_ -> Expect.equal (Just "") (sanitizeCreateRoomTopic "   ")
            , test "plain topic survives" <|
                \_ -> Expect.equal (Just "book club") (sanitizeCreateRoomTopic "book club")
            , test "newline is rejected" <|
                \_ -> Expect.equal Nothing (sanitizeCreateRoomTopic "line\nbreak")
            , test "overlong topic is rejected" <|
                \_ -> Expect.equal Nothing (sanitizeCreateRoomTopic (String.repeat 301 "a"))
            , test "300 chars is the boundary accept" <|
                \_ -> Expect.equal (Just (String.repeat 300 "a")) (sanitizeCreateRoomTopic (String.repeat 300 "a"))
            ]
        , describe "sanitizeCreateInvitee"
            [ test "plain nick survives" <|
                \_ -> Expect.equal (Just "yuki") (sanitizeCreateInvitee " yuki ")
            , test "nick with digits and dash survives" <|
                \_ -> Expect.equal (Just "Yuki_42-x") (sanitizeCreateInvitee "Yuki_42-x")
            , test "empty is rejected" <|
                \_ -> Expect.equal Nothing (sanitizeCreateInvitee "  ")
            , test "spaces inside are rejected" <|
                \_ -> Expect.equal Nothing (sanitizeCreateInvitee "a b")
            , test "leading digit is rejected" <|
                \_ -> Expect.equal Nothing (sanitizeCreateInvitee "4you")
            , test "overlong nick is rejected" <|
                \_ -> Expect.equal Nothing (sanitizeCreateInvitee (String.repeat 65 "a"))
            ]
        , describe "skins"
            [ test "three skins ship" <|
                \_ -> Expect.equal 3 (List.length roomSkins)
            , test "no skin suggests the friends default" <|
                \_ -> Expect.equal defaultFirstLine (suggestedFirstLine Nothing)
            , test "club seed is known" <|
                \_ -> Expect.equal (Just "Club hang") (Maybe.map .topicSeed (roomSkinOption (Just ClubSkin)))
            ]
        , describe "buildCreateRoomTopic"
            [ test "empty input builds empty" <|
                \_ ->
                    Expect.equal (Just "")
                        (buildCreateRoomTopic { skin = Nothing, topic = "", hangLabel = Nothing })
            , test "skin seed alone" <|
                \_ ->
                    Expect.equal (Just "Club hang")
                        (buildCreateRoomTopic { skin = Just ClubSkin, topic = "", hangLabel = Nothing })
            , test "seed plus custom join with middot" <|
                \_ ->
                    Expect.equal (Just "Friends hang · sci-fi")
                        (buildCreateRoomTopic { skin = Just FriendsSkin, topic = "sci-fi", hangLabel = Nothing })
            , test "hang label appends" <|
                \_ ->
                    Expect.equal (Just "sci-fi · Next hang: Saturday")
                        (buildCreateRoomTopic { skin = Nothing, topic = "sci-fi", hangLabel = Just "Saturday" })
            , test "bad custom poisons the build" <|
                \_ ->
                    Expect.equal Nothing
                        (buildCreateRoomTopic { skin = Just FriendsSkin, topic = "a\nb", hangLabel = Nothing })
            , test "overflow join is rejected" <|
                \_ ->
                    Expect.equal Nothing
                        (buildCreateRoomTopic { skin = Just CreatorSkin, topic = String.repeat 300 "a", hangLabel = Nothing })
            ]
        , describe "invitees"
            [ test "target is three" <|
                \_ -> Expect.equal 3 formationInviteTarget
            , test "invalid nick refuses" <|
                \_ -> Expect.equal Nothing (addFormationInvitee [] "a b")
            , test "duplicate keeps the list" <|
                \_ -> Expect.equal (Just [ "yuki" ]) (addFormationInvitee [ "yuki" ] "YUKI")
            , test "cap keeps the list" <|
                \_ ->
                    Expect.equal (Just [ "a", "b", "c" ])
                        (addFormationInvitee [ "a", "b", "c" ] "d")
            , test "append grows the list" <|
                \_ -> Expect.equal (Just [ "a", "b" ]) (addFormationInvitee [ "a" ] "b")
            , test "remove is case-insensitive" <|
                \_ -> Expect.equal [ "b" ] (removeFormationInvitee [ "a", "b" ] " A ")
            ]
        , describe "finish gate and receipts"
            [ test "finish needs the shared receipt" <|
                \_ -> Expect.equal False (canFinishCreateRoom False)
            , test "shared receipt finishes" <|
                \_ -> Expect.equal True (canFinishCreateRoom True)
            , test "rename clears the receipt" <|
                \_ -> Expect.equal True (formationShareReset "?join=%23a" "?join=%23b")
            , test "same url keeps the receipt" <|
                \_ -> Expect.equal False (formationShareReset "?join=%23a" "?join=%23a")
            , test "no prior receipt never resets" <|
                \_ -> Expect.equal False (formationShareReset "" "?join=%23a")
            ]
        , describe "pending creation machine"
            [ test "start arms and sends JOIN" <|
                \_ ->
                    let
                        ( started, outs, admitted ) =
                            startPendingCreateRoom liveModel { name = "friends", topic = "Club hang", firstLine = "hey" }
                    in
                    Expect.all
                        [ \_ -> Expect.equal True admitted
                        , \_ -> Expect.equal (Just "#friends") (Maybe.map .channel started.pendingCreateRoom)
                        , \_ -> Expect.equal [ SendLine "JOIN #friends\r\n" ] outs
                        ]
                        ()
            , test "start rejects a bad name" <|
                \_ ->
                    let
                        ( started, outs, admitted ) =
                            startPendingCreateRoom liveModel { name = "a b", topic = "", firstLine = "" }
                    in
                    Expect.all
                        [ \_ -> Expect.equal False admitted
                        , \_ -> Expect.equal Nothing started.pendingCreateRoom
                        , \_ -> Expect.equal [] outs
                        ]
                        ()
            , test "start stays silent offline" <|
                \_ ->
                    let
                        ( started, outs, admitted ) =
                            startPendingCreateRoom { liveModel | connection = Offline } { name = "friends", topic = "", firstLine = "" }
                    in
                    Expect.all
                        [ \_ -> Expect.equal False admitted
                        , \_ -> Expect.equal Nothing started.pendingCreateRoom
                        , \_ -> Expect.equal [] outs
                        ]
                        ()
            , test "settle sends TOPIC, lands, and prefills" <|
                \_ ->
                    let
                        armed =
                            armPending liveModel "#x" "Club hang" "hey!"

                        ( settled, outs ) =
                            settlePendingCreateRoom armed "#x"
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing settled.pendingCreateRoom
                        , \_ -> Expect.equal False settled.browserOpen
                        , \_ -> Expect.equal "hey!" settled.composer
                        , \_ -> Expect.equal (Just "#x") settled.activeChannel
                        , \_ -> Expect.equal True (List.member (SendLine "TOPIC #x :Club hang\r\n") outs)
                        ]
                        ()
            , test "settle without a topic sends no TOPIC" <|
                \_ ->
                    let
                        armed =
                            armPending liveModel "#x" "" ""

                        ( settled, outs ) =
                            settlePendingCreateRoom armed "#x"
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing settled.pendingCreateRoom
                        , \_ -> Expect.equal "" settled.composer
                        , \_ -> Expect.equal [] (List.filter isTopicLine outs)
                        ]
                        ()
            , test "foreign room never settles ours" <|
                \_ ->
                    let
                        armed =
                            armPending liveModel "#x" "t" "f"

                        ( settled, outs ) =
                            settlePendingCreateRoom armed "#other"
                    in
                    Expect.all
                        [ \_ -> Expect.equal armed.pendingCreateRoom settled.pendingCreateRoom
                        , \_ -> Expect.equal [] outs
                        ]
                        ()
            , test "expired pending clears silently" <|
                \_ ->
                    let
                        armed =
                            { liveModel | pendingCreateRoom = Just { channel = "#x", topic = "t", firstLine = "f", dueMs = 500 } }

                        ( settled, outs ) =
                            settlePendingCreateRoom { armed | nowMs = 99999 } "#x"
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing settled.pendingCreateRoom
                        , \_ -> Expect.equal [] outs
                        , \_ -> Expect.equal "" settled.composer
                        ]
                        ()
            , test "join prompt clears the matching pending" <|
                \_ ->
                    let
                        prompted =
                            setChannelJoinPrompt (armPending liveModel "#x" "t" "f") "#x" "This room is full"
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing prompted.pendingCreateRoom
                        , \_ -> Expect.equal (Just "#x") (Maybe.map .channel prompted.channelJoinPrompt)
                        ]
                        ()
            , test "foreign prompt keeps the pending" <|
                \_ ->
                    let
                        prompted =
                            setChannelJoinPrompt (armPending liveModel "#x" "t" "f") "#other" "This room is full"
                    in
                    Expect.equal (Just "#x") (Maybe.map .channel prompted.pendingCreateRoom)
            , test "watchdog disarms the expired pending" <|
                \_ ->
                    let
                        armed =
                            { liveModel | pendingCreateRoom = Just { channel = "#x", topic = "t", firstLine = "f", dueMs = 500 } }
                    in
                    Expect.equal Nothing (firePendingCreateRoomTimeout 60000 armed).pendingCreateRoom
            , test "watchdog keeps a live pending" <|
                \_ ->
                    let
                        armed =
                            armPending liveModel "#x" "t" "f"
                    in
                    Expect.equal (Just "#x") (Maybe.map .channel (firePendingCreateRoomTimeout 1000 armed).pendingCreateRoom)
            , test "CreateRoomStart reports offline" <|
                \_ ->
                    let
                        ( failed, outs ) =
                            update (CreateRoomStart { name = "friends", topic = "", firstLine = "" }) { liveModel | connection = Offline }
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just createRoomOfflineError) failed.createRoomError
                        , \_ -> Expect.equal [] outs
                        ]
                        ()
            ]
        , describe "formation form state"
            [ test "CreateRoomOpen enters create mode" <|
                \_ ->
                    let
                        ( opened, _ ) =
                            update CreateRoomOpen liveModel
                    in
                    Expect.all
                        [ \_ -> Expect.equal True opened.browserOpen
                        , \_ -> Expect.equal CreateMode opened.browserMode
                        ]
                        ()
            , test "BrowserOpen returns to browse mode" <|
                \_ ->
                    let
                        ( back, _ ) =
                            update BrowserOpen { liveModel | browserOpen = True, browserMode = CreateMode }
                    in
                    Expect.equal BrowseMode back.browserMode
            , test "skin toggle refreshes the suggestion" <|
                \_ ->
                    let
                        ( toggled, _ ) =
                            update (CreateSkinToggle ClubSkin) liveModel
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just ClubSkin) toggled.createSkin
                        , \_ -> Expect.equal (suggestedFirstLine (Just ClubSkin)) toggled.createFirstLine
                        ]
                        ()
            , test "skin toggle twice clears" <|
                \_ ->
                    let
                        ( twice, _ ) =
                            update (CreateSkinToggle ClubSkin) { liveModel | createSkin = Just ClubSkin }
                    in
                    Expect.equal Nothing twice.createSkin
            , test "custom first line survives a skin toggle" <|
                \_ ->
                    let
                        ( toggled, _ ) =
                            update (CreateSkinToggle ClubSkin) { liveModel | createFirstLine = "our thing" }
                    in
                    Expect.equal "our thing" toggled.createFirstLine
            , test "invalid invitee surfaces the error" <|
                \_ ->
                    let
                        ( failed, _ ) =
                            update CreateInviteeAdd { liveModel | createInviteeDraft = "a b" }
                    in
                    Expect.all
                        [ \_ -> Expect.equal "Enter a short name — letters or numbers, no spaces." failed.createInviteeError
                        , \_ -> Expect.equal [] failed.createInvitees
                        ]
                        ()
            , test "valid invitee joins and clears the draft" <|
                \_ ->
                    let
                        ( added, _ ) =
                            update CreateInviteeAdd { liveModel | createInviteeDraft = "ada" }
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ "ada" ] added.createInvitees
                        , \_ -> Expect.equal "" added.createInviteeDraft
                        ]
                        ()
            , test "rename voids the shared receipt" <|
                \_ ->
                    let
                        shared =
                            { liveModel
                                | createName = "friends"
                                , createSharedInvite = True
                                , createLastUrl = Maybe.withDefault "" (createShareUrl { liveModel | createName = "friends" })
                            }

                        ( renamed, _ ) =
                            update (CreateNameInput "friends2") shared
                    in
                    Expect.all
                        [ \_ -> Expect.equal False renamed.createSharedInvite
                        , \_ -> Expect.equal "Room name changed. Share or copy the new invite before entering." renamed.createCopyStatus
                        ]
                        ()
            , test "copy requests the clipboard port" <|
                \_ ->
                    let
                        ( copying, outs ) =
                            update CreateCopyRequest { liveModel | createName = "friends" }
                    in
                    Expect.all
                        [ \_ -> Expect.equal True copying.createCopyBusy
                        , \_ -> Expect.equal 1 (List.length outs)
                        ]
                        ()
            , test "copy stays silent without a name" <|
                \_ ->
                    let
                        ( idle, outs ) =
                            update CreateCopyRequest liveModel
                    in
                    Expect.all
                        [ \_ -> Expect.equal False idle.createCopyBusy
                        , \_ -> Expect.equal [] outs
                        ]
                        ()
            , test "copy result lands the receipt" <|
                \_ ->
                    let
                        ( copying, _ ) =
                            update CreateCopyRequest { liveModel | createName = "friends" }

                        ( landed, _ ) =
                            update (ClipboardResult { tag = "create-invite", ok = True }) copying
                    in
                    Expect.all
                        [ \_ -> Expect.equal True landed.createSharedInvite
                        , \_ -> Expect.equal "Invite link copied. Enter the room when you are ready." landed.createCopyStatus
                        , \_ -> Expect.equal False landed.createCopyBusy
                        ]
                        ()
            , test "stale copy result is ignored" <|
                \_ ->
                    let
                        ( idle, _ ) =
                            update (ClipboardResult { tag = "create-invite", ok = True }) liveModel
                    in
                    Expect.equal False idle.createSharedInvite
            , test "submit needs a name" <|
                \_ ->
                    let
                        ( failed, outs ) =
                            update CreateSubmit liveModel
                    in
                    Expect.all
                        [ \_ -> Expect.equal "Enter a short room name — letters or numbers, no spaces." failed.createNameError
                        , \_ -> Expect.equal [] outs
                        ]
                        ()
            , test "submit needs the shared receipt" <|
                \_ ->
                    let
                        ( failed, outs ) =
                            update CreateSubmit { liveModel | createName = "friends" }
                    in
                    Expect.all
                        [ \_ -> Expect.equal "Copy or share the invite before entering the room." failed.createCopyStatus
                        , \_ -> Expect.equal Nothing failed.pendingCreateRoom
                        , \_ -> Expect.equal [] outs
                        ]
                        ()
            , test "submit arms the creation" <|
                \_ ->
                    let
                        ready =
                            { liveModel | createName = "friends", createSharedInvite = True }

                        ( started, outs ) =
                            update CreateSubmit ready
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just "#friends") (Maybe.map .channel started.pendingCreateRoom)
                        , \_ -> Expect.equal [ SendLine "JOIN #friends\r\n" ] outs
                        ]
                        ()
            ]
        , describe "applySkinFirstLine"
            [ test "empty takes the suggestion" <|
                \_ ->
                    Expect.equal (suggestedFirstLine (Just ClubSkin))
                        (applySkinFirstLine (Just ClubSkin) "")
            , test "known seed swaps to the new skin" <|
                \_ ->
                    Expect.equal (suggestedFirstLine (Just CreatorSkin))
                        (applySkinFirstLine (Just CreatorSkin) (suggestedFirstLine (Just FriendsSkin)))
            , test "custom text is preserved" <|
                \_ -> Expect.equal "our thing" (applySkinFirstLine (Just ClubSkin) "our thing")
            ]
        ]

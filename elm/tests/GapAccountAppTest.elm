module GapAccountAppTest exposing (suite)

{-| v3/gap-account — App-level behaviour: per-account scope resolution
and list isolation, the local-history opt-out and verified erase, the
live encrypted-DM toggle, account protection (ACCOUNTSET), recover /
release, recognised addresses and grouped names, alert coalescing and
click routing, and the attention count behind the title and badge.
-}

import App exposing (..)
import Dict
import Expect
import GapAccount
import Json.Encode as Encode
import Notify
import Set
import Test exposing (Test, describe, test)
import Time


meshUrl : String
meshUrl =
    "wss://ircx.us:8080"


guestKey : String
guestKey =
    "[\"onyx\",\"guest\"]"


accountKey : String -> String
accountKey name =
    "[\"onyx\",\"account\",\"" ++ name ++ "\"]"


{-| Production boots Offline and registers (001) into Live; `blank` is
already Live, so scope tests start from the boot state. -}
fresh : Model
fresh =
    { blank | endpoint = Just meshUrl, connection = Offline }


send : Model -> List String -> ( Model, List Outbound )
send model lines =
    update (WsBatchReceived { at = 1000, lines = lines }) model


welcome : String -> Model -> ( Model, List Outbound )
welcome nick model =
    send model [ ":irc.example 001 " ++ nick ++ " :Welcome" ]


login : String -> Model -> ( Model, List Outbound )
login account model =
    send model [ ":irc.example 900 me me!u@h " ++ account ++ " :You are now logged in as " ++ account ]


guest : Model
guest =
    Tuple.first (welcome "me" fresh)


loadedFor : String -> List String -> Model -> Model
loadedFor key ignored model =
    Tuple.first
        (update
            (GapAccountMsg
                (GapAccount.ScopedListsLoaded
                    (Encode.object
                        [ ( "scope", Encode.string key )
                        , ( "ignored", Encode.list Encode.string ignored )
                        ]
                    )
                )
            )
            model
        )


kai : Model
kai =
    let
        signedIn =
            Tuple.first (login "kai" guest)
    in
    loadedFor (accountKey "kai") [ "troll" ] signedIn


isFx : Outbound -> Bool
isFx out =
    case out of
        GapAccountFx _ ->
            True

        _ ->
            False


fxOf : List Outbound -> List GapAccount.Effect
fxOf outs =
    List.filterMap
        (\o ->
            case o of
                GapAccountFx fx ->
                    Just fx

                _ ->
                    Nothing
        )
        outs


sentLines : List Outbound -> List String
sentLines outs =
    List.filterMap
        (\o ->
            case o of
                SendLine line ->
                    Just line

                _ ->
                    Nothing
        )
        outs


persistTargets : List Outbound -> List String
persistTargets outs =
    List.filterMap
        (\o ->
            case o of
                VaultPersist req ->
                    Just req.target

                _ ->
                    Nothing
        )
        outs


alertTags : List Outbound -> List String
alertTags outs =
    List.filterMap
        (\o ->
            case o of
                NotifyAlert req ->
                    Just req.tag

                _ ->
                    Nothing
        )
        outs


withPrefs : (Model -> Model) -> Model -> Model
withPrefs f model =
    f model


setLocalHistory : Bool -> Model -> Model
setLocalHistory on model =
    let
        prefs =
            model.prefs
    in
    { model | prefs = { prefs | localHistory = on } }


joined : Model
joined =
    Tuple.first (send guest [ ":me!u@h JOIN #lounge" ])


suite : Test
suite =
    describe "v3/gap-account (App)"
        [ describe "scope resolution"
            [ test "registering as a guest scopes to the network's guest memory and asks for its lists" <|
                \_ ->
                    let
                        ( m, outs ) =
                            welcome "me" fresh
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just guestKey) m.gapAccount.scope
                        , \_ -> Expect.equal True m.gapAccount.scopeGuest
                        , \_ ->
                            Expect.equal [ GapAccount.ScopedListsRequest { scope = guestKey, solidOwners = [] } ]
                                (fxOf outs)
                        ]
                        ()
            , test "no endpoint means no scope (nothing is read or written)" <|
                \_ ->
                    let
                        ( m, outs ) =
                            welcome "me" { blank | connection = Offline }
                    in
                    Expect.equal ( Nothing, [] ) ( m.gapAccount.scope, fxOf outs )
            , test "signing in re-scopes to the account and reads the Solid owner slots for it" <|
                \_ ->
                    let
                        ( m, outs ) =
                            login "Kai" guest
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just (accountKey "kai")) m.gapAccount.scope
                        , \_ -> Expect.equal False m.gapAccount.scopeGuest
                        , \_ ->
                            Expect.equal
                                [ GapAccount.ScopedListsRequest
                                    { scope = accountKey "kai"
                                    , solidOwners =
                                        [ "[\"wss://ircx.us:8080\",\"kai\"]"
                                        , "[\"wss://eshmaki.me:8080\",\"kai\"]"
                                        ]
                                    }
                                ]
                                (fxOf outs)
                        ]
                        ()
            , test "the scope sticks while offline (queued sends and local reads keep their owner)" <|
                \_ ->
                    let
                        ( closed, _ ) =
                            update (WsClosed { clean = False, reason = "lost" }) kai
                    in
                    Expect.equal (Just (accountKey "kai")) closed.gapAccount.scope
            , test "a new socket never inherits the previous socket's account" <|
                \_ ->
                    let
                        ( closed, _ ) =
                            update (WsClosed { clean = False, reason = "lost" }) kai

                        ( reopened, _ ) =
                            update (WsOpened { url = meshUrl }) closed

                        ( again, outs ) =
                            welcome "me" reopened
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just guestKey) again.gapAccount.scope
                        , \_ -> Expect.equal [ GapAccount.ScopedListsRequest { scope = guestKey, solidOwners = [] } ] (fxOf outs)
                        ]
                        ()
            , test "hopping to another mesh node keeps the scope and asks for nothing" <|
                \_ ->
                    let
                        hopped =
                            { guest | endpoint = Just "wss://eshmaki.me:8080", connection = Offline }

                        ( back, outs ) =
                            welcome "me" hopped
                    in
                    Expect.equal ( Just guestKey, [] ) ( back.gapAccount.scope, fxOf outs )
            , test "a pinned dev endpoint is its own network" <|
                \_ ->
                    let
                        ( m, _ ) =
                            welcome "me" { blank | endpoint = Just "ws://127.0.0.1:9000/ws", connection = Offline }
                    in
                    Expect.equal (Just "[\"ws://127.0.0.1:9000/ws\",\"guest\"]") m.gapAccount.scope
            ]
        , describe "list isolation"
            [ test "stored lists apply when the scope's answer arrives" <|
                \_ ->
                    let
                        m =
                            loadedFor guestKey [ "Spam", "bot" ] guest
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Set.fromList [ "spam", "bot" ]) m.ignoredUsers
                        , \_ -> Expect.equal (Just guestKey) m.gapAccount.listsLoadedFor
                        ]
                        ()
            , test "an answer for a scope we already left is dropped" <|
                \_ ->
                    let
                        m =
                            loadedFor (accountKey "someone-else") [ "leak" ] guest
                    in
                    Expect.equal ( Set.empty, Nothing ) ( m.ignoredUsers, m.gapAccount.listsLoadedFor )
            , test "a block typed before the scope loads is kept and persisted with the stored list" <|
                \_ ->
                    let
                        ( blocked, _ ) =
                            update (IgnoreUser "Troll") guest

                        ( loaded, outs ) =
                            update
                                (GapAccountMsg
                                    (GapAccount.ScopedListsLoaded
                                        (Encode.object
                                            [ ( "scope", Encode.string guestKey )
                                            , ( "ignored", Encode.list Encode.string [ "old" ] )
                                            ]
                                        )
                                    )
                                )
                                blocked
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Set.fromList [ "old", "troll" ]) loaded.ignoredUsers
                        , \_ ->
                            Expect.equal
                                [ GapAccount.ScopedListsSave
                                    { scope = guestKey
                                    , lists = GapAccount.encodeLists { ignored = Just [ "old", "troll" ], muted = Nothing, highlights = Nothing, notify = Nothing }
                                    }
                                ]
                                (fxOf outs)
                        ]
                        ()
            , test "after the load a block persists only the list that changed, under the scope" <|
                \_ ->
                    let
                        ( m, outs ) =
                            update (IgnoreUser "Pest") kai
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Set.fromList [ "troll", "pest" ]) m.ignoredUsers
                        , \_ ->
                            Expect.equal
                                [ GapAccount.ScopedListsSave
                                    { scope = accountKey "kai"
                                    , lists = GapAccount.encodeLists { ignored = Just [ "pest", "troll" ], muted = Nothing, highlights = Nothing, notify = Nothing }
                                    }
                                ]
                                (fxOf outs)
                        ]
                        ()
            , test "a muted DM, a keyword and a room alert level each persist under the scope" <|
                \_ ->
                    let
                        ( muted, o1 ) =
                            update (MuteDm "Mara") kai

                        ( worded, o2 ) =
                            update (AddHighlightWord "Deploy") kai

                        ( levelled, o3 ) =
                            update (RoomNotifyLevel { channel = "#lounge", level = "none" }) kai

                        scopes outs =
                            List.filterMap
                                (\fx ->
                                    case fx of
                                        GapAccount.ScopedListsSave r ->
                                            Just r.scope

                                        _ ->
                                            Nothing
                                )
                                (fxOf outs)
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (Set.member "mara" muted.mutedDMs)
                        , \_ -> Expect.equal [ "deploy" ] worded.highlightWords
                        , \_ -> Expect.equal (Just "none") (Dict.get "#lounge" levelled.channelNotify)
                        , \_ -> Expect.equal [ accountKey "kai" ] (scopes o1)
                        , \_ -> Expect.equal [ accountKey "kai" ] (scopes o2)
                        , \_ -> Expect.equal [ accountKey "kai" ] (scopes o3)
                        ]
                        ()
            , test "switching accounts empties the previous account's lists and asks for the new scope" <|
                \_ ->
                    let
                        ( lee, outs ) =
                            login "lee" kai
                    in
                    Expect.all
                        [ \_ -> Expect.equal Set.empty lee.ignoredUsers
                        , \_ -> Expect.equal (Just (accountKey "lee")) lee.gapAccount.scope
                        , \_ -> Expect.equal Nothing lee.gapAccount.listsLoadedFor
                        , \_ ->
                            Expect.equal [ accountKey "lee" ]
                                (List.filterMap
                                    (\fx ->
                                        case fx of
                                            GapAccount.ScopedListsRequest r ->
                                                Just r.scope

                                            _ ->
                                                Nothing
                                    )
                                    (fxOf outs)
                                )
                        ]
                        ()
            , test "a switched-to account never writes the previous account's lists" <|
                \_ ->
                    let
                        ( lee, outs ) =
                            login "lee" kai
                    in
                    Expect.equal []
                        (List.filter
                            (\fx ->
                                case fx of
                                    GapAccount.ScopedListsSave _ ->
                                        True

                                    _ ->
                                        False
                            )
                            (fxOf outs)
                        )
            , test "edits made as a guest ride along when that guest signs in" <|
                \_ ->
                    let
                        asGuest =
                            loadedFor guestKey [] guest

                        ( blocked, _ ) =
                            update (IgnoreUser "Pest") asGuest

                        ( signed, _ ) =
                            login "kai" blocked

                        ( reloaded, outs ) =
                            update
                                (GapAccountMsg
                                    (GapAccount.ScopedListsLoaded
                                        (Encode.object
                                            [ ( "scope", Encode.string (accountKey "kai") )
                                            , ( "ignored", Encode.list Encode.string [ "old" ] )
                                            ]
                                        )
                                    )
                                )
                                signed
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Set.fromList [ "pest" ]) signed.ignoredUsers
                        , \_ -> Expect.equal (Set.fromList [ "old", "pest" ]) reloaded.ignoredUsers
                        , \_ -> Expect.equal 1 (List.length (fxOf outs))
                        ]
                        ()
            , test "the device-global list writers stay in the intent stream for the port layer to drop" <|
                \_ ->
                    let
                        ( _, outs ) =
                            update (IgnoreUser "Pest") kai
                    in
                    Expect.equal True
                        (List.any
                            (\o ->
                                case o of
                                    BlocklistsSave _ ->
                                        True

                                    _ ->
                                        False
                            )
                            outs
                        )
            ]
        , describe "local history"
            [ test "history writes flow while local history is on" <|
                \_ ->
                    let
                        ( _, outs ) =
                            send joined [ ":alice!u@h PRIVMSG #lounge :hi" ]
                    in
                    Expect.equal [ "#lounge" ] (persistTargets outs)
            , test "with local history off nothing is written" <|
                \_ ->
                    let
                        ( _, outs ) =
                            send (setLocalHistory False joined) [ ":alice!u@h PRIVMSG #lounge :hi" ]
                    in
                    Expect.equal [] (persistTargets outs)
            , test "the update that switches identity never persists the previous owner's buffers" <|
                \_ ->
                    let
                        ( _, outs ) =
                            send joined [ ":alice!u@h PRIVMSG #lounge :hi", ":irc.example 900 me me!u@h kai :You are now logged in as kai" ]
                    in
                    Expect.equal [] (persistTargets outs)
            , test "turning history off stores the pref, stops writes and starts a verified erase" <|
                \_ ->
                    let
                        ( m, outs ) =
                            update (GapAccountMsg (GapAccount.LocalHistorySet False)) joined
                    in
                    Expect.all
                        [ \_ -> Expect.equal False m.prefs.localHistory
                        , \_ -> Expect.equal GapAccount.Erasing m.gapAccount.erase
                        , \_ -> Expect.equal [ GapAccount.VaultClear ] (fxOf outs)
                        , \_ ->
                            Expect.equal True
                                (List.any
                                    (\o ->
                                        case o of
                                            AppearanceStorePrefs _ ->
                                                True

                                            _ ->
                                                False
                                    )
                                    outs
                                )
                        ]
                        ()
            , test "an erase that is verified says so; one that is not keeps history off and offers a retry" <|
                \_ ->
                    let
                        ( off, _ ) =
                            update (GapAccountMsg (GapAccount.LocalHistorySet False)) joined

                        ( ok, _ ) =
                            update (GapAccountMsg (GapAccount.VaultCleared { ok = True })) off

                        ( bad, _ ) =
                            update (GapAccountMsg (GapAccount.VaultCleared { ok = False })) off
                    in
                    Expect.all
                        [ \_ -> Expect.equal GapAccount.EraseVerified ok.gapAccount.erase
                        , \_ -> Expect.equal (Just "Local history is off. Conversations saved in this browser were erased.") ok.gapAccount.historyStatus
                        , \_ -> Expect.equal GapAccount.EraseFailed bad.gapAccount.erase
                        , \_ -> Expect.equal False bad.prefs.localHistory
                        ]
                        ()
            , test "rows already on screen are not written straight back after an erase" <|
                \_ ->
                    let
                        ( talked, _ ) =
                            send joined [ "@time=2026-01-01T10:00:00.000Z :alice!u@h PRIVMSG #lounge :before" ]

                        ( cleared, _ ) =
                            update (GapAccountMsg GapAccount.HistoryClearConfirm) talked

                        ( _, outs ) =
                            send cleared [ "@time=2026-01-01T10:00:00.000Z :alice!u@h PRIVMSG #lounge :same", "@time=2026-01-01T10:05:00.000Z :alice!u@h PRIVMSG #lounge :after" ]

                        rowsOf os =
                            List.concatMap
                                (\o ->
                                    case o of
                                        VaultPersist req ->
                                            List.map .body req.rows

                                        _ ->
                                            []
                                )
                                os
                    in
                    Expect.equal [ "after" ] (rowsOf outs)
            , test "clear asks first; keeping it changes nothing" <|
                \_ ->
                    let
                        ( asked, askOuts ) =
                            update (GapAccountMsg GapAccount.HistoryClearAsk) joined

                        ( kept, keepOuts ) =
                            update (GapAccountMsg GapAccount.HistoryClearCancel) asked
                    in
                    Expect.all
                        [ \_ -> Expect.equal True asked.gapAccount.clearConfirm
                        , \_ -> Expect.equal [] (fxOf askOuts)
                        , \_ -> Expect.equal False kept.gapAccount.clearConfirm
                        , \_ -> Expect.equal [] (fxOf keepOuts)
                        ]
                        ()
            , test "confirming the clear erases the vault but leaves history on" <|
                \_ ->
                    let
                        ( m, outs ) =
                            update (GapAccountMsg GapAccount.HistoryClearConfirm) joined
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ GapAccount.VaultClear ] (fxOf outs)
                        , \_ -> Expect.equal True m.prefs.localHistory
                        , \_ -> Expect.equal False m.gapAccount.clearConfirm
                        ]
                        ()
            , test "a second clear while one is running is ignored" <|
                \_ ->
                    let
                        ( running, _ ) =
                            update (GapAccountMsg GapAccount.HistoryClearConfirm) joined

                        ( _, outs ) =
                            update (GapAccountMsg GapAccount.HistoryClearConfirm) running
                    in
                    Expect.equal [] (fxOf outs)
            , test "turning history back on resumes writes" <|
                \_ ->
                    let
                        ( off, _ ) =
                            update (GapAccountMsg (GapAccount.LocalHistorySet False)) joined

                        ( done, _ ) =
                            update (GapAccountMsg (GapAccount.VaultCleared { ok = True })) off

                        ( on, _ ) =
                            update (GapAccountMsg (GapAccount.LocalHistorySet True)) done
                    in
                    Expect.equal True on.prefs.localHistory
            ]
        , protectionTests
        , recoverTests
        , namesTests
        , alertTests
        , dataTests
        , describe "live encrypted-DM toggle"
            [ test "turning it off takes effect without a reload and drops a pending key hold" <|
                \_ ->
                    let
                        ( off, _ ) =
                            update (AppearanceSetPref { key = "e2eeDms", value = "false" }) guest
                    in
                    Expect.all
                        [ \_ -> Expect.equal False off.prefs.e2eeDms
                        , \_ -> Expect.equal False off.e2eeDms
                        , \_ -> Expect.equal Nothing off.dmKeyHold
                        ]
                        ()
            , test "turning it back on publishes this device's key straight away" <|
                \_ ->
                    let
                        ( off, _ ) =
                            update (AppearanceSetPref { key = "e2eeDms", value = "false" }) guest

                        ( on, outs ) =
                            update (AppearanceSetPref { key = "e2eeDms", value = "true" }) off
                    in
                    Expect.all
                        [ \_ -> Expect.equal True on.e2eeDms
                        , \_ -> Expect.equal True (List.member DmPublishKey outs)
                        ]
                        ()
            , test "an unrelated preference leaves the gate alone" <|
                \_ ->
                    let
                        ( m, outs ) =
                            update (AppearanceSetPref { key = "linkPreviews", value = "false" }) guest
                    in
                    Expect.equal ( True, False ) ( m.e2eeDms, List.member DmPublishKey outs )
            , test "turning it off releases a pending key hold: the draft stays and sending is now the user's choice" <|
                \_ ->
                    let
                        opened =
                            Tuple.first (update (ChannelSelect "bob") { blank | nowMs = 1000 })

                        ( held, _ ) =
                            update ComposerSend { opened | composer = "hello" }

                        ( off, offOuts ) =
                            update (AppearanceSetPref { key = "e2eeDms", value = "false" }) held

                        ( _, sendOuts ) =
                            update ComposerSend off
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just "bob") held.dmKeyHold
                        , \_ -> Expect.equal ( Nothing, "hello", Nothing ) ( off.dmKeyHold, off.composer, off.composerError )
                        , \_ -> Expect.equal [] (List.filter (String.contains "PRIVMSG") (sentLines offOuts))
                        , \_ -> Expect.equal [ "PRIVMSG bob hello\u{000D}\n" ] (sentLines sendOuts)
                        ]
                        ()
            , test "turning it on while a DM is open asks for that peer's key at once" <|
                \_ ->
                    let
                        opened =
                            Tuple.first (update (ChannelSelect "bob") { blank | nowMs = 1000 })

                        ( off, _ ) =
                            update (AppearanceSetPref { key = "e2eeDms", value = "false" }) opened

                        ( _, onOuts ) =
                            update (AppearanceSetPref { key = "e2eeDms", value = "true" }) off
                    in
                    Expect.equal True (List.any (String.startsWith "METADATA bob GET ocean.dm-key") (sentLines onOuts))
            , test "turning it on warns when plaintext DMs are still queued" <|
                \_ ->
                    let
                        ( off, _ ) =
                            update (AppearanceSetPref { key = "e2eeDms", value = "false" }) guest

                        queued =
                            { off | outbox = [ { id = "q1", target = "mara", text = "hi", queuedAt = 1 } ] }

                        ( on, _ ) =
                            update (AppearanceSetPref { key = "e2eeDms", value = "true" }) queued
                    in
                    Expect.equal [ "Queued direct messages aren't encrypted" ] (List.map .title on.toasts)
            ]
        ]


-- ACCOUNT PROTECTION


typed : String -> Model -> Model
typed password model =
    Tuple.first (update (GapAccountMsg (GapAccount.ProtectPassword password)) model)


toggle : String -> Bool -> Model -> ( Model, List Outbound )
toggle field on model =
    update (GapAccountMsg (GapAccount.ProtectToggle field on)) model


reply : Model -> String -> Model
reply model line =
    Tuple.first (send model [ line ])


protectionTests : Test
protectionTests =
    describe "account protection (ACCOUNTSET secure / enforce)"
        [ test "needs the account password; nothing is sent without it" <|
            \_ ->
                let
                    ( m, outs ) =
                        toggle "secure" True kai
                in
                Expect.all
                    [ \_ -> Expect.equal [] (sentLines outs)
                        , \_ -> Expect.equal (Just "Enter your account password to change protection.") m.gapAccount.protectError
                    ]
                    ()
        , test "sends the verb, clears the typed password and waits for the server" <|
            \_ ->
                let
                    ( m, outs ) =
                        toggle "secure" True (typed "hunter22" kai)
                in
                Expect.all
                    [ \_ -> Expect.equal [ "ACCOUNTSET kai hunter22 secure on\u{000D}\n" ] (sentLines outs)
                    , \_ -> Expect.equal "" m.gapAccount.protectPassword
                    , \_ -> Expect.equal (Just { field = "secure", on = True }) m.gapAccount.protectPending
                    ]
                    ()
        , test "enforce off is its own verb" <|
            \_ ->
                let
                    ( _, outs ) =
                        toggle "enforce" False (typed "hunter22" kai)
                in
                Expect.equal [ "ACCOUNTSET kai hunter22 enforce off\u{000D}\n" ] (sentLines outs)
        , test "an unknown field is refused outright" <|
            \_ ->
                let
                    ( _, outs ) =
                        toggle "flags" True (typed "hunter22" kai)
                in
                Expect.equal [] (sentLines outs)
        , test "a password that cannot ride one token is dropped, never sent or kept" <|
            \_ ->
                let
                    ( m, outs ) =
                        toggle "secure" True (typed "two words" kai)
                in
                Expect.all
                    [ \_ -> Expect.equal [] (sentLines outs)
                    , \_ -> Expect.equal "" m.gapAccount.protectPassword
                    , \_ -> Expect.equal Nothing m.gapAccount.protectPending
                    ]
                    ()
        , test "a guest is told to sign in; an offline socket to reconnect" <|
            \_ ->
                let
                    ( guestTry, g ) =
                        toggle "secure" True (typed "x" guest)

                    ( offline, o ) =
                        toggle "secure" True (typed "hunter22" { kai | connection = Offline })
                in
                Expect.all
                    [ \_ -> Expect.equal ( Just "Sign in first.", [] ) ( guestTry.gapAccount.protectError, sentLines g )
                    , \_ -> Expect.equal ( Just "Reconnect to change protection.", [] ) ( offline.gapAccount.protectError, sentLines o )
                    ]
                    ()
        , test "a second toggle while one is in flight is ignored" <|
            \_ ->
                let
                    ( first, _ ) =
                        toggle "secure" True (typed "hunter22" kai)

                    ( _, outs ) =
                        toggle "enforce" False (typed "hunter22" first)
                in
                Expect.equal [] (sentLines outs)
        , test "the server's update notice settles it, says so and refreshes the real state" <|
            \_ ->
                let
                    ( pending, _ ) =
                        toggle "secure" True (typed "hunter22" kai)

                    ( done, outs ) =
                        send pending [ ":irc.example NOTICE me :Account kai updated (secure)" ]
                in
                Expect.all
                    [ \_ -> Expect.equal Nothing done.gapAccount.protectPending
                    , \_ -> Expect.equal (Just "Saved. You're recognised only after you sign in.") done.gapAccount.protectNotice
                    , \_ -> Expect.equal [ "ACCOUNTINFO\u{000D}\n" ] (sentLines outs)
                    ]
                    ()
        , test "a notice for the other field does not settle this one" <|
            \_ ->
                let
                    ( pending, _ ) =
                        toggle "secure" True (typed "hunter22" kai)

                    done =
                        reply pending ":irc.example NOTICE me :Account kai updated (enforce)"
                in
                Expect.equal (Just { field = "secure", on = True }) done.gapAccount.protectPending
        , test "a wrong password changes nothing and says so" <|
            \_ ->
                let
                    ( pending, _ ) =
                        toggle "enforce" False (typed "nope" kai)

                    done =
                        reply pending ":irc.example 464 me :Password incorrect"
                in
                Expect.all
                    [ \_ -> Expect.equal Nothing done.gapAccount.protectPending
                    , \_ -> Expect.equal (Just "That password didn't match. Nothing was changed.") done.gapAccount.protectError
                    ]
                    ()
        , test "a server FAIL surfaces as plain copy" <|
            \_ ->
                let
                    ( pending, _ ) =
                        toggle "enforce" False (typed "hunter22" kai)

                    done =
                        reply pending ":irc.example FAIL ACCOUNTSET INVALID_VALUE :enforce must be on or off"
                in
                Expect.equal (Just "The server rejected that setting.") done.gapAccount.protectError
        , test "a user imitating the notice cannot settle or flip anything" <|
            \_ ->
                let
                    ( pending, _ ) =
                        toggle "secure" True (typed "hunter22" kai)

                    done =
                        reply pending ":mallory!m@evil NOTICE me :Account kai updated (secure)"
                in
                Expect.equal (Just { field = "secure", on = True }) done.gapAccount.protectPending
        , test "stray protection replies with nothing pending are ignored" <|
            \_ ->
                let
                    done =
                        reply kai ":irc.example NOTICE me :Account kai updated (secure)"
                in
                Expect.equal ( Nothing, Nothing ) ( done.gapAccount.protectNotice, done.gapAccount.protectPending )
        , test "closing the Account sheet forgets the typed password and old messages" <|
            \_ ->
                let
                    ( opened, _ ) =
                        update (SetAccountOpen True) (typed "hunter22" kai)

                    ( closed, _ ) =
                        update (SetAccountOpen False) opened
                in
                Expect.equal ( "", Nothing ) ( closed.gapAccount.protectPassword, closed.gapAccount.protectError )
        , test "an identity change forgets a half-typed password and any pending toggle" <|
            \_ ->
                let
                    ( pending, _ ) =
                        toggle "secure" True (typed "hunter22" kai)

                    ( lee, _ ) =
                        login "lee" pending
                in
                Expect.equal ( "", Nothing ) ( lee.gapAccount.protectPassword, lee.gapAccount.protectPending )
        ]



-- RECOVER / RELEASE


recoverTests : Test
recoverTests =
    describe "recover a name"
        [ test "defaults to the signed-in name and sends RECOVER" <|
            \_ ->
                let
                    ( m, outs ) =
                        update (GapAccountMsg GapAccount.RecoverSubmit) kai
                in
                Expect.all
                    [ \_ -> Expect.equal [ "RECOVER kai\u{000D}\n" ] (sentLines outs)
                    , \_ -> Expect.equal (Just { verb = "RECOVER", nick = "kai" }) m.gapAccount.recoverPending
                    ]
                    ()
        , test "a typed name wins and release uses RELEASE" <|
            \_ ->
                let
                    named =
                        Tuple.first (update (GapAccountMsg (GapAccount.RecoverNickInput "kai-away")) kai)

                    ( _, rec ) =
                        update (GapAccountMsg GapAccount.RecoverSubmit) named

                    ( _, rel ) =
                        update (GapAccountMsg GapAccount.ReleaseSubmit) named
                in
                Expect.equal ( [ "RECOVER kai-away\u{000D}\n" ], [ "RELEASE kai-away\u{000D}\n" ] ) ( sentLines rec, sentLines rel )
        , test "a guest cannot recover; an offline socket cannot either" <|
            \_ ->
                let
                    ( g, gOuts ) =
                        update (GapAccountMsg GapAccount.RecoverSubmit) guest

                    ( o, oOuts ) =
                        update (GapAccountMsg GapAccount.RecoverSubmit) { kai | connection = Offline }
                in
                Expect.all
                    [ \_ -> Expect.equal ( [], Just { ok = False, text = "Sign in to the account that owns the name first." } ) ( sentLines gOuts, g.gapAccount.recoverStatus )
                    , \_ -> Expect.equal ( [], Just { ok = False, text = "Reconnect to do this." } ) ( sentLines oOuts, o.gapAccount.recoverStatus )
                    ]
                    ()
        , test "a name that is not one wire token is refused before sending" <|
            \_ ->
                let
                    named =
                        Tuple.first (update (GapAccountMsg (GapAccount.RecoverNickInput "a b")) kai)

                    ( m, outs ) =
                        update (GapAccountMsg GapAccount.RecoverSubmit) named
                in
                Expect.equal ( [], Just { ok = False, text = "Enter a valid name (no spaces)." } ) ( sentLines outs, m.gapAccount.recoverStatus )
        , test "the server's yes frees the name and the client takes it back with NICK" <|
            \_ ->
                let
                    ( pending, _ ) =
                        update (GapAccountMsg GapAccount.RecoverSubmit) kai

                    ( done, outs ) =
                        send pending [ ":irc.example NOTICE me :RECOVER: forced the holder off kai; reclaim it now" ]
                in
                Expect.all
                    [ \_ -> Expect.equal Nothing done.gapAccount.recoverPending
                    , \_ -> Expect.equal (Just { ok = True, text = "Done \u{2014} the name is free for you now." }) done.gapAccount.recoverStatus
                    , \_ -> Expect.equal [ "NICK kai\u{000D}\n" ] (sentLines outs)
                    ]
                    ()
        , test "nobody holding the name needs no NICK" <|
            \_ ->
                let
                    ( pending, _ ) =
                        update (GapAccountMsg GapAccount.RecoverSubmit) kai

                    ( done, outs ) =
                        send pending [ ":irc.example NOTICE me :RECOVER: nobody else is holding that nick" ]
                in
                Expect.equal ( [], Just { ok = True, text = "Nobody else is using that name." } ) ( sentLines outs, done.gapAccount.recoverStatus )
        , test "release reports the dropped hold" <|
            \_ ->
                let
                    ( pending, _ ) =
                        update (GapAccountMsg GapAccount.ReleaseSubmit) kai

                    ( done, _ ) =
                        send pending [ ":irc.example NOTICE me :RELEASE: dropped the server hold on kai" ]
                in
                Expect.equal (Just { ok = True, text = "Released \u{2014} the server is no longer holding that name." }) done.gapAccount.recoverStatus
        , test "ACCESS_DENIED and NICK_NOT_REGISTERED read as plain errors" <|
            \_ ->
                let
                    ( pending, _ ) =
                        update (GapAccountMsg GapAccount.RecoverSubmit) kai

                    ( denied, _ ) =
                        send pending [ ":irc.example FAIL RECOVER ACCESS_DENIED :no" ]

                    ( pending2, _ ) =
                        update (GapAccountMsg GapAccount.RecoverSubmit) kai

                    ( unreg, _ ) =
                        send pending2 [ ":irc.example FAIL RECOVER NICK_NOT_REGISTERED :no" ]
                in
                Expect.equal
                    ( Just { ok = False, text = "Sign in to the account that owns that name first." }
                    , Just { ok = False, text = "That name isn't registered." }
                    )
                    ( denied.gapAccount.recoverStatus, unreg.gapAccount.recoverStatus )
        , test "a forged RECOVER notice from a user changes nothing" <|
            \_ ->
                let
                    ( pending, _ ) =
                        update (GapAccountMsg GapAccount.RecoverSubmit) kai

                    ( done, outs ) =
                        send pending [ ":mallory!m@evil NOTICE me :RECOVER: forced the holder off kai; reclaim it now" ]
                in
                Expect.equal ( [], Just { verb = "RECOVER", nick = "kai" } ) ( sentLines outs, done.gapAccount.recoverPending )
        , test "a reply with no request in flight is ignored" <|
            \_ ->
                let
                    ( done, outs ) =
                        send kai [ ":irc.example NOTICE me :RECOVER: forced the holder off kai; reclaim it now" ]
                in
                Expect.equal ( [], Nothing ) ( sentLines outs, done.gapAccount.recoverStatus )
        ]



-- RECOGNISED ADDRESSES + GROUPED NAMES


namesTests : Test
namesTests =
    describe "recognised addresses and grouped names"
        [ test "opening the Account sheet lists both when signed in on a live socket" <|
            \_ ->
                let
                    ( _, outs ) =
                        update (SetAccountOpen True) kai
                in
                Expect.equal True
                    (List.all (\l -> List.member l (sentLines outs)) [ "RECOGNIZE LIST\u{000D}\n", "GROUP LIST\u{000D}\n" ])
        , test "a guest asks for nothing" <|
            \_ ->
                let
                    ( _, outs ) =
                        update (SetAccountOpen True) guest
                in
                Expect.equal False (List.any (\l -> String.startsWith "RECOGNIZE" l || String.startsWith "GROUP" l) (sentLines outs))
        , test "rows fold into the list and the end marker settles loading" <|
            \_ ->
                let
                    ( opened, _ ) =
                        update (SetAccountOpen True) kai

                    ( rows, _ ) =
                        send opened
                            [ ":irc.example NOTICE me :Recognize: kai!*@home.example"
                            , ":irc.example NOTICE me :Recognize: kai!*@work.example"
                            , ":irc.example NOTICE me :GROUP kai (primary)"
                            , ":irc.example NOTICE me :GROUP kai-away"
                            , ":irc.example NOTICE me :GROUP: end of list"
                            ]
                in
                Expect.all
                    [ \_ -> Expect.equal [ "kai!*@home.example", "kai!*@work.example" ] rows.gapAccount.recognize
                    , \_ -> Expect.equal [ { nick = "kai", primary = True }, { nick = "kai-away", primary = False } ] rows.gapAccount.groupNicks
                    , \_ -> Expect.equal False rows.gapAccount.groupLoading
                    ]
                    ()
        , test "an empty list notice clears the list" <|
            \_ ->
                let
                    ( opened, _ ) =
                        update (SetAccountOpen True) kai

                    ( rows, _ ) =
                        send opened [ ":irc.example NOTICE me :Recognition list for kai is empty" ]
                in
                Expect.equal ( [], False ) ( rows.gapAccount.recognize, rows.gapAccount.recognizeLoading )
        , test "adding sends one validated mask and a confirmed add re-lists" <|
            \_ ->
                let
                    drafted =
                        Tuple.first (update (GapAccountMsg (GapAccount.RecognizeDraft "kai!*@home.example")) kai)

                    ( added, outs ) =
                        update (GapAccountMsg GapAccount.RecognizeAdd) drafted

                    ( confirmed, again ) =
                        send added [ ":irc.example NOTICE me :Recognize kai!*@home.example: added to your recognition list" ]
                in
                Expect.all
                    [ \_ -> Expect.equal [ "RECOGNIZE ADD kai!*@home.example\u{000D}\n" ] (sentLines outs)
                    , \_ -> Expect.equal "" added.gapAccount.recognizeDraft
                    , \_ -> Expect.equal [ "RECOGNIZE LIST\u{000D}\n" ] (sentLines again)
                    , \_ -> Expect.equal (Just { ok = True, text = "kai!*@home.example added." }) confirmed.gapAccount.recognizeStatus
                    ]
                    ()
        , test "a mask with spaces is refused with guidance, nothing sent" <|
            \_ ->
                let
                    drafted =
                        Tuple.first (update (GapAccountMsg (GapAccount.RecognizeDraft "two words")) kai)

                    ( m, outs ) =
                        update (GapAccountMsg GapAccount.RecognizeAdd) drafted
                in
                Expect.equal ( [], True ) ( sentLines outs, m.gapAccount.recognizeStatus /= Nothing )
        , test "removing sends DEL for that mask" <|
            \_ ->
                let
                    ( _, outs ) =
                        update (GapAccountMsg (GapAccount.RecognizeRemove "kai!*@home.example")) kai
                in
                Expect.equal [ "RECOGNIZE DEL kai!*@home.example\u{000D}\n" ] (sentLines outs)
        , test "group add / primary / remove send their verbs" <|
            \_ ->
                let
                    drafted =
                        Tuple.first (update (GapAccountMsg (GapAccount.GroupDraft "kai-away")) kai)

                    ( _, add ) =
                        update (GapAccountMsg GapAccount.GroupAdd) drafted

                    ( _, prim ) =
                        update (GapAccountMsg (GapAccount.GroupPrimary "kai-away")) kai

                    ( _, del ) =
                        update (GapAccountMsg (GapAccount.GroupRemove "kai-away")) kai
                in
                Expect.equal
                    [ [ "GROUP ADD kai-away\u{000D}\n" ], [ "GROUP PRIMARY kai-away\u{000D}\n" ], [ "GROUP DEL kai-away\u{000D}\n" ] ]
                    [ sentLines add, sentLines prim, sentLines del ]
        , test "a group error is shown as plain copy" <|
            \_ ->
                let
                    ( m, _ ) =
                        send kai [ ":irc.example NOTICE me :GROUP: no such grouped nick" ]
                in
                Expect.equal (Just { ok = False, text = "That name isn't in your group." }) m.gapAccount.groupStatus
        , test "another identity's lists are never shown after a switch" <|
            \_ ->
                let
                    ( opened, _ ) =
                        update (SetAccountOpen True) kai

                    ( filled, _ ) =
                        send opened [ ":irc.example NOTICE me :Recognize: kai!*@home.example" ]

                    ( lee, _ ) =
                        login "lee" filled
                in
                Expect.equal ( [], [] ) ( lee.gapAccount.recognize, lee.gapAccount.groupNicks )
        ]



-- DESKTOP ALERTS


alertBase : Model
alertBase =
    { guest | pushEnabled = True, notifyPermission = Notify.Granted, pageVisible = False, appFocused = False, nowMs = 100000 }


dmFrom : String -> String -> String
dmFrom nick text =
    ":" ++ nick ++ "!u@h PRIVMSG me :" ++ text


alertTests : Test
alertTests =
    describe "desktop alerts"
        [ test "the first alert fires and remembers which identity raised it" <|
            \_ ->
                let
                    ( m, outs ) =
                        send alertBase [ dmFrom "mara" "hello" ]
                in
                Expect.all
                    [ \_ -> Expect.equal [ "onyx-mara" ] (alertTags outs)
                    , \_ -> Expect.equal (Just guestKey) (Dict.get "onyx-mara" m.gapAccount.alertTags)
                    ]
                    ()
        , test "throttled alerts are held, not dropped, and coalesce when the window opens" <|
            \_ ->
                let
                    ( first, _ ) =
                        send alertBase [ dmFrom "mara" "one" ]

                    ( held, heldOuts ) =
                        send first [ dmFrom "mara" "two", dmFrom "mara" "three" ]

                    ( early, earlyOuts ) =
                        update (Tick (Time.millisToPosix 103000)) held

                    ( late, lateOuts ) =
                        update (Tick (Time.millisToPosix 107000)) early

                    titles outs =
                        List.filterMap
                            (\o ->
                                case o of
                                    NotifyAlert req ->
                                        Just req.title

                                    _ ->
                                        Nothing
                            )
                            outs
                in
                Expect.all
                    [ \_ -> Expect.equal [] (alertTags heldOuts)
                    , \_ -> Expect.equal 1 (Dict.size held.gapAccount.alertQueue)
                    , \_ -> Expect.equal [] (titles earlyOuts)
                    , \_ -> Expect.equal [ "2 new alerts in mara" ] (titles lateOuts)
                    , \_ -> Expect.equal 0 (Dict.size late.gapAccount.alertQueue)
                    ]
                    ()
        , test "a held alert is re-decided: muting the sender in the meantime silences it" <|
            \_ ->
                let
                    ( first, _ ) =
                        send alertBase [ dmFrom "mara" "one" ]

                    ( held, _ ) =
                        send first [ dmFrom "mara" "two" ]

                    ( muted, _ ) =
                        update (MuteDm "mara") held

                    ( _, outs ) =
                        update (Tick (Time.millisToPosix 107000)) muted
                in
                Expect.equal [] (alertTags outs)
        , test "a held alert is dropped when you come back to the app" <|
            \_ ->
                let
                    ( first, _ ) =
                        send alertBase [ dmFrom "mara" "one" ]

                    ( held, _ ) =
                        send first [ dmFrom "mara" "two" ]

                    back =
                        { held | pageVisible = True, appFocused = True }

                    ( _, outs ) =
                        update (Tick (Time.millisToPosix 107000)) back
                in
                Expect.equal [] (alertTags outs)
        , test "the held queue is bounded" <|
            \_ ->
                let
                    ( first, _ ) =
                        send alertBase [ dmFrom "mara" "one" ]

                    many =
                        List.range 1 80 |> List.map (\i -> dmFrom ("u" ++ String.fromInt i) "x")

                    -- every distinct sender is its own conversation, each throttle-free,
                    -- so push the same conversation set through a Tick-free burst instead
                    ( burst, _ ) =
                        send first many
                in
                Expect.atMost GapAccount.maxQueuedAlerts (Dict.size burst.gapAccount.alertQueue)
        , test "clicking an alert opens the conversation it is about" <|
            \_ ->
                let
                    ( raised, _ ) =
                        send alertBase [ dmFrom "mara" "hello" ]

                    ( clicked, _ ) =
                        update (GapAccountMsg (GapAccount.NotifyClicked { tag = "onyx-mara" })) raised
                in
                Expect.equal (Just "mara") (Maybe.map String.toLower clicked.activeChannel)
        , test "a click on an alert raised for another identity opens nothing" <|
            \_ ->
                let
                    ( raised, _ ) =
                        send alertBase [ dmFrom "mara" "hello" ]

                    ga =
                        raised.gapAccount

                    switched =
                        { raised | gapAccount = { ga | scope = Just (accountKey "lee") } }

                    ( clicked, _ ) =
                        update (GapAccountMsg (GapAccount.NotifyClicked { tag = "onyx-mara" })) switched
                in
                Expect.equal raised.activeChannel clicked.activeChannel
        , test "a click with an unknown or forged tag opens nothing" <|
            \_ ->
                let
                    ( raised, _ ) =
                        send alertBase [ dmFrom "mara" "hello" ]

                    ( clicked, outs ) =
                        update (GapAccountMsg (GapAccount.NotifyClicked { tag = "onyx-#secret" })) raised
                in
                Expect.equal ( raised.activeChannel, [] ) ( clicked.activeChannel, outs )
        ]



-- ATTENTION + SAVED SEARCHES + IMPORT REFUSAL


dataTests : Test
dataTests =
    describe "attention count and data controls"
        [ test "unread DMs and room mentions feed the title/badge count; room chatter does not" <|
            \_ ->
                let
                    ( dm, _ ) =
                        send joined [ dmFrom "mara" "hello", ":alice!u@h PRIVMSG #lounge :chatter" ]
                in
                Expect.equal 1 dm.gapAccount.badge
        , test "a muted DM does not count" <|
            \_ ->
                let
                    ( muted, _ ) =
                        update (MuteDm "mara") joined

                    ( dm, _ ) =
                        send muted [ dmFrom "mara" "hello" ]
                in
                Expect.equal 0 dm.gapAccount.badge
        , test "saved-search clear asks, then requests; the answer sets the status" <|
            \_ ->
                let
                    ( asked, _ ) =
                        update (GapAccountMsg GapAccount.SearchClearAsk) guest

                    ( sent, outs ) =
                        update (GapAccountMsg GapAccount.SearchClearConfirm) asked

                    ( done, _ ) =
                        update (SearchClearedReceived { cleared = True }) sent

                    ( failed, _ ) =
                        update (SearchClearedReceived { cleared = False }) sent
                in
                Expect.all
                    [ \_ -> Expect.equal True asked.gapAccount.searchClearConfirm
                    , \_ -> Expect.equal True (List.member SearchClearRequest outs)
                    , \_ -> Expect.equal (Just "Saved searches cleared on this device.") done.gapAccount.searchStatus
                    , \_ -> Expect.equal (Just "Couldn't clear saved searches. Try again.") failed.gapAccount.searchStatus
                    ]
                    ()
        , test "saved-search export and import are reachable" <|
            \_ ->
                let
                    ( _, ex ) =
                        update (GapAccountMsg GapAccount.SearchExport) guest

                    ( _, im ) =
                        update (GapAccountMsg GapAccount.SearchImport) guest

                    ( done, _ ) =
                        update (SearchImportedReceived { imported = 3 }) guest
                in
                Expect.all
                    [ \_ -> Expect.equal True (List.member SearchExportRequest ex)
                    , \_ -> Expect.equal True (List.member SearchImportPick im)
                    , \_ -> Expect.equal (Just "Imported 3 saved searches.") done.gapAccount.searchStatus
                    ]
                    ()
        , test "an oversized import file is refused with a message and nothing staged" <|
            \_ ->
                let
                    ( m, outs ) =
                        update (GapAccountMsg (GapAccount.ImportRefused { reason = "too big" })) guest
                in
                Expect.equal ( Just "too big", Nothing, [] ) ( m.gapAccount.importStatus, m.gapAccount.importReview, persistTargets outs )
        , test "export asks for review first and only then downloads" <|
            \_ ->
                let
                    ( asked, askOuts ) =
                        update (GapAccountMsg GapAccount.ExportAsk) guest

                    ( canceled, _ ) =
                        update (GapAccountMsg GapAccount.ExportCancel) asked

                    ( confirmed, confirmOuts ) =
                        update (GapAccountMsg GapAccount.ExportConfirm) asked
                in
                Expect.all
                    [ \_ -> Expect.equal ( True, True ) ( asked.gapAccount.exportConfirm, List.all (\o -> o /= VaultExportRequest) askOuts )
                    , \_ -> Expect.equal False canceled.gapAccount.exportConfirm
                    , \_ -> Expect.equal ( False, True ) ( confirmed.gapAccount.exportConfirm, List.member VaultExportRequest confirmOuts )
                    ]
                    ()
        ]

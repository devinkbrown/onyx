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
                        [ \_ -> Expect.equal (Set.fromList [ "old", "pest" ]) reloaded.ignoredUsers
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

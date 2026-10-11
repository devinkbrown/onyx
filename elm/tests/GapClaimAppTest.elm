module GapClaimAppTest exposing (suite)

{-| v3/gap-claim — App wiring: a scan when a scope settles (signed-in or
guest), attach / delete only from the person's own click and always
for the settled scope, stale answers after an identity change, the
re-count after a local-history erase, and the refresh after the vault
changed under the open conversations.
-}

import App exposing (..)
import Dict
import Expect
import GapAccount
import GapClaim
import Json.Encode as Encode
import Test exposing (Test, describe, test)


meshUrl : String
meshUrl =
    "wss://ircx.us:8080"


guestKey : String
guestKey =
    "[\"onyx\",\"guest\"]"


accountKey : String -> String
accountKey name =
    "[\"onyx\",\"account\",\"" ++ name ++ "\"]"


fresh : Model
fresh =
    { blank | endpoint = Just meshUrl, connection = Offline }


send : Model -> List String -> ( Model, List Outbound )
send model lines =
    update (WsBatchReceived { at = 1000, lines = lines }) model


welcome : Model -> ( Model, List Outbound )
welcome model =
    send model [ ":irc.example 001 me :Welcome" ]


login : String -> Model -> ( Model, List Outbound )
login account model =
    send model [ ":irc.example 900 me me!u@h " ++ account ++ " :You are now logged in as " ++ account ]


claimFx : List Outbound -> List { op : String, scope : String, guest : String }
claimFx =
    List.filterMap
        (\o ->
            case o of
                GapClaimFx req ->
                    Just req

                _ ->
                    Nothing
        )


ops : List Outbound -> List ( String, String )
ops outs =
    List.map (\r -> ( r.op, r.scope )) (claimFx outs)


guest : ( Model, List Outbound )
guest =
    welcome fresh


scanAnswer : String -> Int -> GapClaim.Msg
scanAnswer scope rows =
    GapClaim.Answered
        (Encode.object
            [ ( "kind", Encode.string "scan" )
            , ( "scope", Encode.string scope )
            , ( "ok", Encode.bool True )
            , ( "rows", Encode.int rows )
            , ( "conversations", Encode.int 4 )
            , ( "oldest", Encode.int 1772528400000 )
            , ( "newest", Encode.int 1791493200000 )
            ]
        )


doneAnswer : String -> String -> Bool -> Int -> Int -> Encode.Value
doneAnswer scope op ok moved remaining =
    Encode.object
        [ ( "kind", Encode.string "done" )
        , ( "scope", Encode.string scope )
        , ( "op", Encode.string op )
        , ( "ok", Encode.bool ok )
        , ( "total", Encode.int (moved + remaining) )
        , ( "attached", Encode.int (if op == "attach" then moved else 0) )
        , ( "deleted", Encode.int (if op == "delete" then moved else 0) )
        , ( "remaining", Encode.int remaining )
        ]


claim : GapClaim.Msg -> Model -> ( Model, List Outbound )
claim msg model =
    update (GapClaimMsg msg) model


fetchTargets : List Outbound -> List String
fetchTargets =
    List.filterMap
        (\o ->
            case o of
                VaultFetch r ->
                    Just r.target

                _ ->
                    Nothing
        )


{-| A registered account session that has been told 5 rows are waiting. -}
kaiFound : Model
kaiFound =
    let
        ( signedIn, _ ) =
            login "kai" (Tuple.first guest)
    in
    Tuple.first (claim (scanAnswer (accountKey "kai") 5) signedIn)


suite : Test
suite =
    describe "v3/gap-claim (App)"
        [ describe "scanning"
            [ test "a guest scope settling scans the vault once, naming the guest scope to spare" <|
                \_ ->
                    let
                        ( m, outs ) =
                            guest
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ { op = "scan", scope = guestKey, guest = guestKey } ] (claimFx outs)
                        , \_ -> Expect.equal GapClaim.Scanning m.gapClaim.scan
                        ]
                        ()
            , test "signing in re-scans for the account (the answer for the guest scope no longer applies)" <|
                \_ ->
                    let
                        ( asGuest, _ ) =
                            guest

                        ( asKai, outs ) =
                            login "kai" asGuest

                        ( late, _ ) =
                            claim (scanAnswer guestKey 9) asKai
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ ( "scan", accountKey "kai" ) ] (ops outs)
                        , \_ -> Expect.equal GapClaim.Scanning late.gapClaim.scan
                        ]
                        ()
            , test "an unchanged scope never re-scans (reconnects, hopping between mesh nodes)" <|
                \_ ->
                    let
                        ( asGuest, _ ) =
                            guest

                        ( closed, _ ) =
                            update (WsClosed { clean = False, reason = "lost" }) asGuest

                        ( reopened, _ ) =
                            update (WsOpened { url = meshUrl }) closed

                        ( again, outs ) =
                            welcome reopened
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] (claimFx outs)
                        , \_ -> Expect.equal asGuest.gapClaim.scope again.gapClaim.scope
                        ]
                        ()
            , test "no endpoint means no scope and no scan" <|
                \_ ->
                    let
                        ( m, outs ) =
                            welcome { blank | connection = Offline }
                    in
                    Expect.equal ( [], GapClaim.Unknown ) ( claimFx outs, m.gapClaim.scan )
            , test "a scan that finds rows shows the prompt and asks for nothing more - it never attaches by itself" <|
                \_ ->
                    let
                        ( asGuest, _ ) =
                            guest

                        ( m, outs ) =
                            claim (scanAnswer guestKey 40) asGuest
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (GapClaim.homeVisible m.gapClaim)
                        , \_ -> Expect.equal [] (claimFx outs)
                        , \_ -> Expect.equal GapClaim.Resting m.gapClaim.phase
                        ]
                        ()
            ]
        , describe "attach"
            [ test "attaches to the settled account scope, with focus on the status line" <|
                \_ ->
                    let
                        ( m, outs ) =
                            claim GapClaim.AttachClicked kaiFound
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ ( "attach", accountKey "kai" ) ] (ops outs)
                        , \_ -> Expect.equal True (GapClaim.busy m.gapClaim)
                        , \_ -> Expect.equal True (List.member (PrefsFocus { id = "gc-home-status" }) outs)
                        ]
                        ()
            , test "from Preferences the focus goes to that card's status line" <|
                \_ ->
                    let
                        ( _, outs ) =
                            claim GapClaim.AttachClicked { kaiFound | prefsOpen = True }
                    in
                    Expect.equal True (List.member (PrefsFocus { id = "gc-prefs-status" }) outs)
            , test "as a guest it attaches to the guest scope" <|
                \_ ->
                    let
                        ( asGuest, _ ) =
                            guest

                        ( found, _ ) =
                            claim (scanAnswer guestKey 3) asGuest

                        ( _, outs ) =
                            claim GapClaim.AttachClicked found
                    in
                    Expect.equal [ ( "attach", guestKey ) ] (ops outs)
            , test "is refused while local history is off" <|
                \_ ->
                    let
                        prefs =
                            kaiFound.prefs

                        ( _, outs ) =
                            claim GapClaim.AttachClicked { kaiFound | prefs = { prefs | localHistory = False } }
                    in
                    Expect.equal [] (claimFx outs)
            , test "a finished attach voids the DM privacy proofs and re-reads every open, still-empty conversation" <|
                \_ ->
                    let
                        ( joined, _ ) =
                            send kaiFound [ ":me!u@h JOIN #lounge" ]

                        empty =
                            { joined
                                | channels =
                                    Dict.map (\_ ch -> { ch | messages = [] }) joined.channels
                                , vaultDmPrivacy = Dict.fromList [ ( "alice", DmPrivacyPlain ) ]
                            }

                        ( running, _ ) =
                            claim GapClaim.AttachClicked empty

                        ( done, outs ) =
                            claim (GapClaim.Answered (doneAnswer (accountKey "kai") "attach" True 5 0)) running

                        fetches =
                            fetchTargets outs
                    in
                    Expect.all
                        [ \_ -> Expect.equal Dict.empty done.vaultDmPrivacy
                        , \_ -> Expect.equal True (List.member "#lounge" fetches)
                        , \_ -> Expect.equal GapClaim.Clear done.gapClaim.scan
                        ]
                        ()
            , test "a finish for the identity we signed out of never touches the new one's card" <|
                \_ ->
                    let
                        ( running, _ ) =
                            claim GapClaim.AttachClicked kaiFound

                        ( asLee, _ ) =
                            login "lee" running

                        ( after, outs ) =
                            claim (GapClaim.Answered (doneAnswer (accountKey "kai") "attach" True 5 0)) asLee
                    in
                    Expect.all
                        [ \_ -> Expect.equal GapClaim.Resting after.gapClaim.phase
                        , \_ -> Expect.equal [] (fetchTargets outs)
                        , \_ -> Expect.equal (Just (accountKey "lee")) after.gapClaim.scope
                        ]
                        ()
            ]
        , describe "delete"
            [ test "needs the confirm step; focus lands on the safe choice" <|
                \_ ->
                    let
                        ( asked, askOuts ) =
                            claim GapClaim.DeleteAsked kaiFound

                        ( confirmed, confirmOuts ) =
                            claim GapClaim.DeleteConfirmed asked

                        ( skipped, skipOuts ) =
                            claim GapClaim.DeleteConfirmed kaiFound
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] (claimFx askOuts)
                        , \_ -> Expect.equal True (List.member (PrefsFocus { id = "gc-home-keep" }) askOuts)
                        , \_ -> Expect.equal [ ( "delete", accountKey "kai" ) ] (ops confirmOuts)
                        , \_ -> Expect.equal True (GapClaim.busy confirmed.gapClaim)
                        , \_ -> Expect.equal [] (claimFx skipOuts)
                        , \_ -> Expect.equal GapClaim.Resting skipped.gapClaim.phase
                        ]
                        ()
            , test "cancelling returns focus to the Delete button" <|
                \_ ->
                    let
                        ( asked, _ ) =
                            claim GapClaim.DeleteAsked kaiFound

                        ( _, outs ) =
                            claim GapClaim.DeleteCancelled asked
                    in
                    Expect.equal True (List.member (PrefsFocus { id = "gc-home-delete" }) outs)
            ]
        , describe "not now"
            [ test "is persisted for the device and hides the Home card for good" <|
                \_ ->
                    let
                        ( m, outs ) =
                            claim GapClaim.NotNowClicked kaiFound
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ ( "dismiss", accountKey "kai" ) ] (ops outs)
                        , \_ -> Expect.equal False (GapClaim.homeVisible m.gapClaim)
                        , \_ -> Expect.equal True (GapClaim.prefsVisible m.gapClaim)
                        ]
                        ()
            , test "survives an identity change on this device" <|
                \_ ->
                    let
                        ( dismissed, _ ) =
                            claim GapClaim.NotNowClicked kaiFound

                        ( asLee, _ ) =
                            login "lee" dismissed
                    in
                    Expect.equal True asLee.gapClaim.dismissed
            ]
        , describe "local history erase"
            [ test "a verified erase re-counts the vault (the unstamped rows went with it)" <|
                \_ ->
                    let
                        ( _, outs ) =
                            update (GapAccountMsg (GapAccount.VaultCleared { ok = True })) kaiFound
                    in
                    Expect.equal [ ( "scan", accountKey "kai" ) ] (ops outs)
            , test "a failed erase changes nothing here" <|
                \_ ->
                    let
                        ( m, outs ) =
                            update (GapAccountMsg (GapAccount.VaultCleared { ok = False })) kaiFound
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] (claimFx outs)
                        , \_ -> Expect.equal kaiFound.gapClaim.scan m.gapClaim.scan
                        ]
                        ()
            ]
        ]

module DmSafetyTest exposing (suite)

{-| v3/dmsafety vectors, mirroring `shell/DmSafetySheet.test.tsx`,
`shell/DmKeyChangeBanner.test.tsx` (+ `.rotationRace`) and
`shell/RoomInviteShare.test.tsx`: pure helpers through `DmSafety` /
`InviteShare`, behavior through `App.update`, rendering through
`View.view`.
-}

import App exposing (..)
import Base64Url
import Dict
import DmSafety exposing (HeaderState(..))
import Expect
import Html
import Html.Attributes
import InviteShare
import Json.Encode
import Set
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View


validKey : Int -> String
validKey fill =
    Base64Url.encode (0x04 :: List.repeat 64 fill)


k1 : String
k1 =
    validKey 0xAB


k2 : String
k2 =
    validKey 0xCD


sn : String
sn =
    "12345 67890 11111 22222 33333 44444 55555 66666 77777 88888 99999 00000"


snNew : String
snNew =
    "54321 09876 11111 22222 33333 44444 55555 66666 77777 88888 99999 13579"


chan : String -> String -> Channel
chan name topic =
    { name = name
    , topic = topic
    , members = Dict.empty
    , modes = ""
    , messages = []
    , lastSeen = Nothing
    , unread = 0
    , highlights = 0
    , createdAt = Nothing
    }


{-| Active DM with Trev, one advertised device key, an owner. -}
dm : Model
dm =
    { blank
        | ourNick = "me"
        , endpoint = Just "wss://onyx.test/ws"
        , origin = "https://onyx.test"
        , activeChannel = Just "Trev"
        , channels = Dict.fromList [ ( "trev", chan "Trev" "" ), ( "#lounge", chan "#lounge" "Friday hangout" ) ]
        , dmDirectory = { primary = Dict.singleton "trev" k1, devices = Dict.singleton "trev" [ k1 ] }
    }


keyChanged : Model
keyChanged =
    { dm | peerKeyChanges = Set.singleton "trev", dmDirectory = { primary = Dict.singleton "trev" k2, devices = Dict.singleton "trev" [ k2 ] } }


room : Model
room =
    { dm | activeChannel = Just "#lounge" }


step : Msg -> Model -> Model
step msg model =
    Tuple.first (update msg model)


outs : Msg -> Model -> List Outbound
outs msg model =
    Tuple.second (update msg model)


query : Model -> Query.Single Msg
query model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


testid : String -> Selector.Selector
testid id =
    Selector.attribute (Html.Attributes.attribute "data-testid" id)


requested : List Outbound -> List { peer : String, keys : List String }
requested =
    List.filterMap
        (\o ->
            case o of
                DmSafetyRequested r ->
                    Just { peer = r.peer, keys = r.keys }

                _ ->
                    Nothing
        )


opened : Model
opened =
    step (DmSafetyToggle "Trev") dm
        |> step (DmSafetyResult { peer = "trev", keys = [ k1 ], current = Just sn, pending = Nothing })


changedWithEvidence : Model
changedWithEvidence =
    step (DmSafetyResult { peer = "trev", keys = [ k2 ], current = Just sn, pending = Just snNew })
        (step DmSafetyClose keyChanged)


suite : Test
suite =
    describe "v3/dmsafety"
        [ pure
        , safetyPanel
        , keyChangeRow
        , inviteShare
        ]


pure : Test
pure =
    describe "pure helpers"
        [ test "header state: key change wins, then private, else plaintext" <|
            \_ ->
                Expect.equal
                    [ DmSafety.headerState { keyChanged = True, sealKeys = [ k1 ] }
                    , DmSafety.headerState { keyChanged = False, sealKeys = [ k1 ] }
                    , DmSafety.headerState { keyChanged = False, sealKeys = [] }
                    ]
                    [ KeyChanged, Private, Plaintext ]
        , test "safety number splits into readable groups" <|
            \_ -> Expect.equal (List.length (DmSafety.groups (Just sn))) 12
        , test "device readiness copy" <|
            \_ ->
                Expect.equal (List.map DmSafety.deviceReadiness [ 0, 1, 3 ])
                    [ "Not received", "1 device received", "3 devices received" ]
        , test "seal device label clamps to two digits" <|
            \_ -> Expect.equal (List.map DmSafety.sealDeviceLabel [ 0, 3, 150 ]) [ "01", "03", "99" ]
        , test "empty number copy: loading / no trusted pair / no key" <|
            \_ ->
                Expect.equal
                    [ DmSafety.emptyNumberCopy { name = "Mika", loading = True, deviceCount = 0 }
                    , DmSafety.emptyNumberCopy { name = "Mika", loading = False, deviceCount = 1 }
                    , DmSafety.emptyNumberCopy { name = "Mika", loading = False, deviceCount = 0 }
                    ]
                    [ "Loading this device’s safety number…"
                    , "No trusted device pair is ready to compare yet."
                    , "Mika’s device key has not arrived yet."
                    ]
        , test "multi-device labels" <|
            \_ ->
                Expect.equal
                    [ DmSafety.numberLabel 3, DmSafety.verifyGuidanceTail 3, DmSafety.warningDeviceClause 3, DmSafety.numberAriaLabel "Trev" 3 "1" ]
                    [ "Current safety number · 3 devices", "all 3 of their advertised device keys", " or a new device appears", "Safety number for Trev across 3 devices: 1" ]
        , test "key-change state line" <|
            \_ ->
                Expect.equal
                    [ DmSafety.keyChangeStateCopy { current = Nothing, pending = Nothing }
                    , DmSafety.keyChangeStateCopy { current = Just sn, pending = Nothing }
                    , DmSafety.keyChangeStateCopy { current = Just sn, pending = Just snNew }
                    ]
                    [ Just "Safety numbers are unavailable. Try again to calculate them."
                    , Just "Waiting for both exact safety numbers before acceptance."
                    , Nothing
                    ]
        , test "accept label states" <|
            \_ ->
                Expect.equal
                    [ DmSafety.acceptLabel { accepting = False, persistFailed = False }
                    , DmSafety.acceptLabel { accepting = True, persistFailed = False }
                    , DmSafety.acceptLabel { accepting = False, persistFailed = True }
                    ]
                    [ "Accept new device key", "Saving trusted key…", "Retry saving trusted key" ]
        , test "a result for a different key set is dropped" <|
            \_ ->
                DmSafety.blank
                    |> DmSafety.markLoading { peer = "trev", keys = [ k2 ], keyChanged = True }
                    |> DmSafety.foldResult { peer = "trev", keys = [ k1 ], current = Just sn, pending = Just snNew }
                    |> DmSafety.currentNumber "trev"
                    |> Expect.equal Nothing
        , test "needsLoad tracks the (keys, key-change) stamp" <|
            \_ ->
                let
                    s =
                        DmSafety.markLoading { peer = "trev", keys = [ k1 ], keyChanged = False } DmSafety.blank
                in
                Expect.equal
                    [ DmSafety.needsLoad { peer = "Trev", keys = [ k1 ], keyChanged = False } s
                    , DmSafety.needsLoad { peer = "Trev", keys = [ k2 ], keyChanged = False } s
                    , DmSafety.needsLoad { peer = "Trev", keys = [ k1 ], keyChanged = True } s
                    ]
                    [ False, True, True ]
        , test "invite share titles and tags" <|
            \_ ->
                let
                    link =
                        InviteShare.payload { channel = "#lounge", network = "Onyx", origin = "https://onyx.test/invite/", nowMs = 0 }

                    net =
                        InviteShare.payload { channel = "", network = "Onyx", origin = "https://onyx.test/invite/", nowMs = 0 }
                in
                Expect.equal
                    [ InviteShare.shareTitle "Onyx" link, InviteShare.shareText "Onyx" net, link.shareUrl, net.shareUrl ]
                    [ "Join #lounge on Onyx", "A friend invited you to Onyx.", "https://onyx.test/invite/?join=%23lounge", "https://onyx.test/invite/" ]
        ]


safetyPanel : Test
safetyPanel =
    describe "DmSafetySheet"
        [ test "self-gates to DMs: Verify on a DM, Invite friends on a room" <|
            \_ ->
                Expect.all
                    [ \_ -> query dm |> Query.has [ testid "dm-safety-verify" ]
                    , \_ -> query room |> Query.hasNot [ testid "dm-safety-verify" ]
                    , \_ -> query room |> Query.has [ testid "room-invite-friends" ]
                    , \_ -> query dm |> Query.hasNot [ testid "room-invite-friends" ]
                    ]
                    ()
        , test "the header states the E2EE posture" <|
            \_ ->
                Expect.all
                    [ \_ -> query dm |> Query.find [ testid "dm-safety-private" ] |> Query.has [ Selector.text "Private", Selector.attribute (Html.Attributes.attribute "aria-label" DmSafety.dmPrivateChipLabel) ]
                    , \_ -> query { dm | dmDirectory = { primary = Dict.empty, devices = Dict.empty } } |> Query.has [ testid "dm-safety-plaintext" ]
                    , \_ -> query keyChanged |> Query.find [ testid "dm-safety-keychanged" ] |> Query.has [ Selector.text "Trev's device key changed" ]
                    , \_ -> query keyChanged |> Query.hasNot [ testid "dm-safety-private" ]
                    ]
                    ()
        , test "Verify toggles the panel and requests the safety number once" <|
            \_ ->
                let
                    ( next, out ) =
                        update (DmSafetyToggle "Trev") dm
                in
                Expect.all
                    [ \_ -> Expect.equal (requested out) [ { peer = "trev", keys = [ k1 ] } ]
                    , \_ -> Expect.equal (requested (outs (DmSafetyResult { peer = "trev", keys = [ k1 ], current = Just sn, pending = Nothing }) next)) []
                    , \_ -> query next |> Query.find [ testid "dm-safety-verify" ] |> Query.has [ Selector.attribute (Html.Attributes.attribute "aria-expanded" "true") ]
                    , \_ -> query next |> Query.has [ Selector.text "Loading this device’s safety number…" ]
                    , \_ -> query dm |> Query.find [ testid "dm-safety-verify" ] |> Query.has [ Selector.attribute (Html.Attributes.attribute "aria-expanded" "false") ]
                    ]
                    ()
        , test "renders the loaded number without exposing device keys" <|
            \_ ->
                query opened
                    |> Expect.all
                        [ Query.has [ Selector.text "Review this safety number with Trev" ]
                        , Query.find [ testid "dm-safety-number" ]
                            >> Query.has [ Selector.attribute (Html.Attributes.attribute "aria-label" ("Safety number for Trev: " ++ sn)), Selector.attribute (Html.Attributes.attribute "aria-live" "off") ]
                        , Query.has [ Selector.text "Number available" ]
                        , Query.has [ Selector.text "1 device received" ]
                        , Query.hasNot [ Selector.text k1 ]
                        , Query.hasNot [ Selector.attribute (Html.Attributes.attribute "role" "dialog") ]
                        ]
        , test "multi-device count and labels" <|
            \_ ->
                let
                    multi =
                        { dm | dmDirectory = { primary = Dict.singleton "trev" k1, devices = Dict.singleton "trev" [ k1, k2, validKey 0x11 ] } }
                in
                query (step (DmSafetyToggle "Trev") multi)
                    |> Expect.all
                        [ Query.has [ Selector.text "3 devices received" ]
                        , Query.has [ Selector.text "Current safety number · 3 devices" ]
                        ]
        , test "ownerless loads settle unavailable without a port call" <|
            \_ ->
                let
                    ( next, out ) =
                        update (DmSafetyToggle "Trev") { dm | endpoint = Nothing }
                in
                Expect.all
                    [ \_ -> Expect.equal (requested out) []
                    , \_ -> query next |> Query.has [ Selector.text "No trusted device pair is ready to compare yet." ]
                    , \_ -> query next |> Query.has [ Selector.text "Number unavailable" ]
                    ]
                    ()
        , test "close then reopen retries the loader" <|
            \_ ->
                let
                    closed =
                        step DmSafetyClose opened
                in
                Expect.all
                    [ \_ -> query closed |> Query.hasNot [ Selector.id "dm-safety-panel" ]
                    , \_ -> Expect.equal (requested (outs (DmSafetyToggle "Trev") closed)) [ { peer = "trev", keys = [ k1 ] } ]
                    ]
                    ()
        , test "Escape and the close button both close the panel" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        query opened
                            |> Query.find [ Selector.id "dm-safety-panel" ]
                            |> Event.simulate (Event.custom "keydown" (Json.Encode.object [ ( "key", Json.Encode.string "Escape" ) ]))
                            |> Event.expect DmSafetyClose
                    , \_ ->
                        query opened
                            |> Query.find [ Selector.attribute (Html.Attributes.attribute "aria-label" "Close safety number") ]
                            |> Event.simulate Event.click
                            |> Event.expect DmSafetyClose
                    ]
                    ()
        , test "switching conversations closes the panel and never paints the prior number" <|
            \_ ->
                let
                    switched =
                        step (ChannelSelect "#lounge") opened
                in
                Expect.all
                    [ \_ -> Expect.equal switched.dmSafety.openFor Nothing
                    , \_ -> query switched |> Query.hasNot [ Selector.text "11111" ]
                    ]
                    ()
        , test "a slow result for a rotated key set is ignored" <|
            \_ ->
                let
                    loading =
                        step (DmSafetyToggle "Trev") dm
                in
                step (DmSafetyResult { peer = "trev", keys = [ k2 ], current = Just snNew, pending = Nothing }) loading
                    |> .dmSafety
                    |> DmSafety.currentNumber "trev"
                    |> Expect.equal Nothing
        , test "never claims verification or uses jargon" <|
            \_ ->
                query opened
                    |> Expect.all
                        [ Query.has [ Selector.text "treat the identity as unverified" ]
                        , Query.hasNot [ Selector.text "TOFU" ]
                        , Query.hasNot [ Selector.text "MITM" ]
                        ]
        ]


keyChangeRow : Test
keyChangeRow =
    describe "DmKeyChangeBanner (inline row)"
        [ test "appears inline for the active DM peer with a pending change" <|
            \_ ->
                query keyChanged
                    |> Query.find [ testid "dm-keychange" ]
                    |> Expect.all
                        [ Query.has [ Selector.attribute (Html.Attributes.attribute "role" "region") ]
                        , Query.has [ Selector.text "'s device identity changed" ]
                        , Query.find [ Selector.attribute (Html.Attributes.attribute "role" "alert") ]
                            >> Query.has [ Selector.text "Trev's device key changed. Compare the new safety number before you continue." ]
                        ]
        , test "absent without a change, and on a channel even with a change elsewhere" <|
            \_ ->
                Expect.all
                    [ \_ -> query dm |> Query.hasNot [ testid "dm-keychange" ]
                    , \_ -> query { keyChanged | activeChannel = Just "#lounge" } |> Query.hasNot [ testid "dm-keychange" ]
                    ]
                    ()
        , test "a key-change flag kicks off the evidence load for the active peer" <|
            \_ ->
                outs (DmOpenFailed { peer = "Trev", messageId = 1, keyChanged = True })
                    { dm | dmDirectory = keyChanged.dmDirectory }
                    |> requested
                    |> Expect.equal [ { peer = "trev", keys = [ k2 ] } ]
        , test "renders BOTH safety numbers with silenced outputs" <|
            \_ ->
                query changedWithEvidence
                    |> Expect.all
                        [ Query.find [ Selector.attribute (Html.Attributes.attribute "aria-label" "Current (trusted) safety number") ]
                            >> Query.has [ Selector.attribute (Html.Attributes.attribute "aria-live" "off"), Selector.text "12345" ]
                        , Query.find [ Selector.attribute (Html.Attributes.attribute "aria-label" "New (unverified) safety number") ]
                            >> Query.has [ Selector.text "13579" ]
                        ]
        , test "shows a computing state while numbers load" <|
            \_ ->
                query (step DmSafetyClose keyChanged)
                    |> Query.findAll [ Selector.text "Computing safety number…" ]
                    |> Query.count (Expect.equal 2)
        , test "Accept is refused until both exact numbers are in" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (outs (DmKeyAccept "Trev") (step DmSafetyClose keyChanged)) []
                    , \_ ->
                        query (step DmSafetyClose keyChanged)
                            |> Query.find [ testid "dm-keychange-accept" ]
                            |> Query.has [ Selector.disabled True ]
                    ]
                    ()
        , test "Accept re-pins the exact live key set" <|
            \_ ->
                case outs (DmKeyAccept "Trev") changedWithEvidence of
                    [ DmKeyAcceptRequested r ] ->
                        Expect.equal ( r.peer, r.keys ) ( "trev", [ k2 ] )

                    other ->
                        Expect.fail (Debug.toString other)
        , test "a persisted accept clears the warning" <|
            \_ ->
                let
                    accepting =
                        step (DmKeyAccept "Trev") changedWithEvidence

                    done =
                        step (DmKeyAccepted { peer = "trev", keys = [ k2 ], ok = True }) accepting
                in
                Expect.all
                    [ \_ -> query accepting |> Query.has [ Selector.text "Saving trusted key…" ]
                    , \_ -> Expect.equal (Set.member "trev" done.peerKeyChanges) False
                    , \_ -> query done |> Query.hasNot [ testid "dm-keychange" ]
                    , \_ -> query done |> Query.has [ testid "dm-safety-private" ]
                    ]
                    ()
        , test "a failed persistence keeps the warning and offers a retry" <|
            \_ ->
                let
                    failed =
                        step (DmKeyAccept "Trev") changedWithEvidence
                            |> step (DmKeyAccepted { peer = "trev", keys = [ k2 ], ok = False })
                in
                Expect.all
                    [ \_ -> Expect.equal (Set.member "trev" failed.peerKeyChanges) True
                    , \_ -> query failed |> Query.has [ Selector.text "Retry saving trusted key" ]
                    , \_ -> query failed |> Query.has [ Selector.text "The new key was not saved. Messages remain locked. Try accepting again." ]
                    , \_ -> Expect.notEqual (outs (DmKeyAccept "Trev") failed) []
                    ]
                    ()
        , test "never clears the warning for a key set the directory moved past" <|
            \_ ->
                let
                    accepting =
                        step (DmKeyAccept "Trev") changedWithEvidence

                    rotated =
                        { accepting | dmDirectory = { primary = Dict.singleton "trev" k1, devices = Dict.singleton "trev" [ k1 ] } }
                in
                step (DmKeyAccepted { peer = "trev", keys = [ k2 ], ok = True }) rotated
                    |> .peerKeyChanges
                    |> Set.member "trev"
                    |> Expect.equal True
        , test "a rotation reloads evidence for the new pending key" <|
            \_ ->
                outs (DmSafetyClose)
                    { changedWithEvidence | dmDirectory = { primary = Dict.singleton "trev" k1, devices = Dict.singleton "trev" [ k1 ] } }
                    |> requested
                    |> Expect.equal [ { peer = "trev", keys = [ k1 ] } ]
        , test "Keep messages locked drops the warning without trusting the key" <|
            \_ ->
                let
                    ( kept, out ) =
                        update (DmKeyKeepLocked "Trev") changedWithEvidence
                in
                Expect.all
                    [ \_ -> Expect.equal out []
                    , \_ -> Expect.equal (Set.member "trev" kept.peerKeyChanges) False
                    , \_ ->
                        query changedWithEvidence
                            |> Query.find [ testid "dm-keychange-dismiss" ]
                            |> Event.simulate Event.click
                            |> Event.expect (DmKeyKeepLocked "Trev")
                    ]
                    ()
        ]


inviteShare : Test
inviteShare =
    let
        sheetOn model =
            query model |> Query.find [ testid "room-invite-share" ]
    in
    describe "RoomInviteShare"
        [ test "opens from the room header with the room name and real topic" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        query room
                            |> Query.find [ testid "room-invite-friends" ]
                            |> Event.simulate Event.click
                            |> Event.expect (InviteShareOpen "#lounge")
                    , \_ ->
                        sheetOn (step (InviteShareOpen "#lounge") room)
                            |> Expect.all
                                [ Query.has [ Selector.attribute (Html.Attributes.attribute "role" "dialog"), Selector.text "Invite friends" ]
                                , Query.find [ Selector.attribute (Html.Attributes.attribute "aria-label" "Invite preview") ] >> Query.has [ Selector.text "#lounge" ]
                                , Query.has [ Selector.text "Friday hangout" ]
                                , Query.has [ Selector.text "Send this link. Friends choose a name and request access." ]
                                , Query.has [ Selector.text "Anyone with the link can open the invite. Room access rules still apply." ]
                                , Query.has [ Selector.text "https://onyx.test/invite/?join=%23lounge" ]
                                , Query.has [ Selector.text "Copy link" ]
                                , Query.hasNot [ Selector.text "IRC" ]
                                ]
                    ]
                    ()
        , test "shares a network invite when no room is selected" <|
            \_ ->
                sheetOn (step (InviteShareOpen "") room)
                    |> Expect.all
                        [ Query.find [ Selector.attribute (Html.Attributes.attribute "aria-label" "Invite preview") ] >> Query.has [ Selector.text "Onyx" ]
                        , Query.has [ Selector.text "https://onyx.test/invite/" ]
                        ]
        , test "explains the copy fallback (no native share port)" <|
            \_ ->
                sheetOn (step (InviteShareOpen "#lounge") room)
                    |> Query.has [ Selector.text "Sharing is not available here. Copy the link instead." ]
        , test "keeps copying available while disconnected" <|
            \_ ->
                sheetOn (step (InviteShareOpen "#lounge") { room | connection = Offline })
                    |> Expect.all
                        [ Query.has [ Selector.text "You’re offline. You can still copy this link and share it." ]
                        , Query.find [ testid "room-invite-share-copy" ] >> Query.has [ Selector.disabled False ]
                        ]
        , test "copies the existing invite link through the clipboard outbound" <|
            \_ ->
                let
                    ( busy, out ) =
                        update InviteShareCopy (step (InviteShareOpen "#lounge") room)
                in
                Expect.all
                    [ \_ -> Expect.equal out [ ClipboardCopy { text = "https://onyx.test/invite/?join=%23lounge", tag = "invite-share:#lounge" } ]
                    , \_ -> Expect.equal (outs InviteShareCopy busy) []
                    , \_ -> sheetOn busy |> Query.has [ Selector.text "Copying link…" ]
                    ]
                    ()
        , test "an empty live region carries success then failure" <|
            \_ ->
                let
                    busy =
                        step InviteShareCopy (step (InviteShareOpen "#lounge") room)

                    status model =
                        sheetOn model |> Query.find [ testid "room-invite-share-status" ]

                    copied =
                        step (ClipboardResult { tag = "invite-share:#lounge", ok = True }) busy

                    failed =
                        step (ClipboardResult { tag = "invite-share:#lounge", ok = False }) (step InviteShareCopy copied)
                in
                Expect.all
                    [ \_ -> status busy |> Query.has [ Selector.attribute (Html.Attributes.attribute "aria-live" "polite"), Selector.attribute (Html.Attributes.attribute "aria-atomic" "true") ]
                    , \_ -> status copied |> Query.has [ Selector.text "Invite link copied to clipboard." ]
                    , \_ -> status failed |> Query.has [ Selector.text "Copy failed. Select and copy the link shown above." ]
                    ]
                    ()
        , test "results for a closed or re-targeted sheet are ignored" <|
            \_ ->
                let
                    busy =
                        step InviteShareCopy (step (InviteShareOpen "#lounge") room)
                in
                Expect.all
                    [ \_ -> Expect.equal (step (ClipboardResult { tag = "invite-share:#other", ok = True }) busy).inviteShare busy.inviteShare
                    , \_ -> Expect.equal (step (ClipboardResult { tag = "invite-share:#lounge", ok = True }) (step InviteShareClose busy)).inviteShare Nothing
                    ]
                    ()
        , test "close button and Escape dismiss the sheet" <|
            \_ ->
                let
                    open =
                        step (InviteShareOpen "#lounge") room
                in
                Expect.all
                    [ \_ ->
                        sheetOn open
                            |> Query.find [ Selector.attribute (Html.Attributes.attribute "aria-label" "Close invite friends") ]
                            |> Event.simulate Event.click
                            |> Event.expect InviteShareClose
                    , \_ ->
                        sheetOn open
                            |> Query.find [ Selector.attribute (Html.Attributes.attribute "role" "dialog") ]
                            |> Event.simulate (Event.custom "keydown" (Json.Encode.object [ ( "key", Json.Encode.string "Escape" ) ]))
                            |> Event.expect InviteShareClose
                    , \_ -> Expect.equal (step InviteShareClose open).inviteShare Nothing
                    ]
                    ()
        , test "Home's Invite friends opens the sheet for the first joined room" <|
            \_ ->
                Expect.equal (homeInviteChannel room) "#lounge"
        ]

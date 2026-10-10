module Account2Test exposing (suite)

{-| Vectors for the v3/account2 slice, mirroring
`SessionReclaimBanner.test.tsx`, `SessionsDevicesSection.test.tsx`,
`ThemeImportDialog.test.tsx`, `portableIdentity.test.ts` and the
store's friends / watch / custom-status verbs (no oracle component).
-}

import Account2
import App exposing (..)
import Dict
import Expect
import Html
import Html.Attributes
import Json.Encode as Encode
import Session exposing (SessionState(..))
import Set
import Studio
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import ThemeTokens
import View
import View.Account2
import Wire


step : Msg -> Model -> Model
step msg model =
    Tuple.first (update msg model)


outs : Msg -> Model -> List Outbound
outs msg model =
    Tuple.second (update msg model)


owned : Model
owned =
    { blank | endpoint = Just "wss://onyx.test/ws", ourNick = "me", nowMs = 1784980800000 }


account : Model
account =
    { owned | accountName = Just "alice" }


render : Html.Html Msg -> Query.Single Msg
render html =
    Query.fromHtml (Html.div [] [ html ])


shell : Model -> Query.Single Msg
shell model =
    View.view model |> .body |> Html.div [] |> Query.fromHtml


sends : List Outbound -> List String
sends =
    List.filterMap
        (\o ->
            case o of
                SendLine line ->
                    Just line

                _ ->
                    Nothing
        )


row : Int -> Bool -> SessionState -> Maybe String -> Session.AccountSessionRow
row index current state sid =
    { index = index, current = current, signonMs = 1710000000000 + index, state = state, sid = sid }


sharedTheme : Studio.CustomTheme
sharedTheme =
    { id = "custom:shared", name = "Shared Theme", base = "ocean", overrides = Dict.fromList [ ( "--lapis", "#33ccff" ) ] }


withShared : Model
withShared =
    { owned | studioCustoms = [ sharedTheme ], themeId = "custom:shared", origin = "https://onyx.test" }


suite : Test
suite =
    describe "v3/account2"
        [ reclaimTests
        , sessionsTests
        , themeTests
        , portableTests
        , peopleTests
        , statusTests
        ]


reclaimTests : Test
reclaimTests =
    let
        banner phase =
            render (View.Account2.reclaimBanner { blank | sessionReclaim = Just { phase = phase, kind = Nothing } })
    in
    describe "SessionReclaimBanner"
        [ test "is absent for an ordinary guest / first connect" <|
            \_ ->
                render (View.Account2.reclaimBanner blank)
                    |> Query.findAll [ Selector.attribute (attr "data-testid" "session-reclaim-banner") ]
                    |> Query.count (Expect.equal 0)
        , test "restoring is a neutral polite status with no action" <|
            \_ ->
                banner Restoring
                    |> Query.find [ Selector.attribute (attr "data-testid" "session-reclaim-banner") ]
                    |> Query.has
                        [ Selector.attribute (attr "role" "status")
                        , Selector.attribute (attr "aria-live" "polite")
                        , Selector.attribute (attr "aria-atomic" "true")
                        , Selector.attribute (attr "data-state" "restoring")
                        , Selector.text "Restoring your session…"
                        , Selector.text "Reconnecting you to where you left off."
                        ]
        , test "restoring offers no sign-in action" <|
            \_ ->
                banner Restoring
                    |> Query.findAll [ Selector.attribute (attr "data-testid" "session-reclaim-signin") ]
                    |> Query.count (Expect.equal 0)
        , test "reclaimed shows Session restored with no action" <|
            \_ ->
                Expect.all
                    [ Query.has [ Selector.attribute (attr "data-state" "reclaimed"), Selector.text "Session restored" ]
                    , Query.findAll [ Selector.attribute (attr "data-testid" "session-reclaim-signin") ] >> Query.count (Expect.equal 0)
                    ]
                    (banner Reclaimed)
        , test "a rejected resume fails closed to Sign in again" <|
            \_ ->
                Expect.all
                    [ Query.has [ Selector.attribute (attr "data-state" "reclaim-failed"), Selector.text "Couldn't restore your session", Selector.text "Sign in again to keep going." ]
                    , Query.find [ Selector.attribute (attr "data-testid" "session-reclaim-signin") ] >> Query.has [ Selector.text "Sign in again" ]
                    ]
                    (banner ReclaimFailed)
        , test "a lapsed bearer fails closed to Sign in again" <|
            \_ ->
                Expect.all
                    [ Query.has [ Selector.attribute (attr "data-state" "sign-in-again"), Selector.text "Your session has expired" ]
                    , Query.find [ Selector.attribute (attr "data-testid" "session-reclaim-signin") ] >> Query.has [ Selector.text "Sign in again" ]
                    ]
                    (banner SignInAgain)
        , test "Sign in again dispatches the disconnect" <|
            \_ ->
                banner ReclaimFailed
                    |> Query.find [ Selector.attribute (attr "data-testid" "session-reclaim-signin") ]
                    |> Event.simulate Event.click
                    |> Event.expect SessionReclaimSignIn
        , test "Sign in again disconnects to the gate and clears the banner" <|
            \_ ->
                let
                    ( next, out ) =
                        update SessionReclaimSignIn { blank | sessionReclaim = Just { phase = SignInAgain, kind = Nothing } }
                in
                Expect.all
                    [ \_ -> Expect.equal Nothing next.sessionReclaim
                    , \_ -> Expect.equal True next.connectGate
                    , \_ -> Expect.equal True (List.member WsDisconnect out)
                    ]
                    ()
        , test "Dismiss clears the banner" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        banner Reclaimed
                            |> Query.find [ Selector.attribute (attr "data-testid" "session-reclaim-dismiss") ]
                            |> Event.simulate Event.click
                            |> Event.expect SessionReclaimDismiss
                    , \_ -> Expect.equal Nothing (step SessionReclaimDismiss { blank | sessionReclaim = Just { phase = Reclaimed, kind = Nothing } }).sessionReclaim
                    ]
                    ()
        , test "the shell renders the banner in the notices strip" <|
            \_ ->
                shell { blank | sessionReclaim = Just { phase = SignInAgain, kind = Nothing } }
                    |> Query.find [ Selector.class "onyx-notices" ]
                    |> Query.has [ Selector.attribute (attr "data-testid" "session-reclaim-banner") ]
        ]


sessionsTests : Test
sessionsTests =
    let
        three =
            { account | accountSessions = [ row 1 True Attached Nothing, row 2 False Attached Nothing, row 3 False Attached Nothing ] }
    in
    describe "SessionsDevicesSection revoke"
        [ test "no bulk revoke while only this connection is listed" <|
            \_ ->
                render (View.Account2.revokeOthers { account | accountSessions = [ row 1 True Attached Nothing ] })
                    |> Query.findAll [ Selector.attribute (attr "data-testid" "sessions-revoke-others") ]
                    |> Query.count (Expect.equal 0)
        , test "detached rows are not bulk targets" <|
            \_ ->
                Session.otherAttachedSessions [ row 1 True Attached Nothing, row 2 False Detached Nothing ]
                    |> Expect.equal []
        , test "Revoke other devices asks first, then drops every other attached session" <|
            \_ ->
                let
                    asked =
                        step SessionsRevokeOthersAsk three
                in
                Expect.all
                    [ \_ ->
                        render (View.Account2.revokeOthers asked)
                            |> Query.has [ Selector.text "Revoke 2 other sessions? Those devices will need to sign in again." ]
                    , \_ ->
                        sends (outs SessionsRevokeOthersConfirm asked)
                            |> Expect.equal
                                [ Wire.formatIrcLine "SESSION" [ "DROP", "#2" ]
                                , Wire.formatIrcLine "SESSION" [ "DROP", "#3" ]
                                ]
                    , \_ -> Expect.equal False (step SessionsRevokeOthersConfirm asked).sessionsRevokeConfirm
                    ]
                    ()
        , test "cancelling the confirm drops nothing" <|
            \_ ->
                let
                    ( next, out ) =
                        update SessionsRevokeOthersCancel (step SessionsRevokeOthersAsk three)
                in
                Expect.equal ( False, [] ) ( next.sessionsRevokeConfirm, out )
        , test "a sid-bearing row revokes by physical sid" <|
            \_ ->
                sends (outs SessionsRevokeOthersConfirm { account | accountSessions = [ row 1 True Attached Nothing, row 2 False Attached (Just "0123456789abcdeffedcba9876543210") ] })
                    |> Expect.equal [ Wire.formatIrcLine "SESSION" [ "DROP", "sid=0123456789abcdeffedcba9876543210" ] ]
        , test "singular copy for one other session" <|
            \_ -> Expect.equal "Revoke 1 other session? Those devices will need to sign in again." (Account2.revokeOthersPrompt 1)
        , test "the account panel's Devices section carries the action" <|
            \_ ->
                shell { three | accountOpen = True }
                    |> Query.has [ Selector.attribute (attr "data-testid" "sessions-revoke-others") ]
        ]


themeTests : Test
themeTests =
    let
        code =
            Studio.encodeThemeShare ThemeTokens.themeIds sharedTheme

        sheet model =
            render (View.Account2.themeShareSheet model)
    in
    describe "ThemeImportDialog"
        [ test "extractCode trims a bare code" <|
            \_ -> Expect.equal "abc" (Account2.extractThemeCode "  abc \n")
        , test "extractCode reads ?theme= from a link" <|
            \_ -> Expect.equal "abc" (Account2.extractThemeCode "https://onyx.test/app/?x=1&theme=abc#top")
        , test "extractCode keeps text with theme= but no query" <|
            \_ -> Expect.equal "theme=abc" (Account2.extractThemeCode "theme=abc")
        , test "renders the import guidance and a dialog named Share & import a theme" <|
            \_ ->
                sheet { withShared | themeShareOpen = True }
                    |> Expect.all
                        [ Query.find [ Selector.attribute (attr "role" "dialog") ] >> Query.has [ Selector.text "Share & import a theme" ]
                        , Query.find [ Selector.id "theme-import-code" ] >> Query.has [ Selector.attribute (attr "aria-describedby" "theme-import-help") ]
                        , Query.has [ Selector.text "Paste a shared Onyx theme code or link. It is checked locally before import; no code is run." ]
                        ]
        , test "a valid code offers a target-specific import action" <|
            \_ ->
                sheet (step (ThemeShareInput code) { owned | themeShareOpen = True })
                    |> Query.has [ Selector.attribute (attr "aria-label" "Import theme Shared Theme") ]
        , test "a share link pastes as well as a bare code" <|
            \_ ->
                sheet (step (ThemeShareInput ("https://onyx.test?theme=" ++ code)) { owned | themeShareOpen = True })
                    |> Query.has [ Selector.attribute (attr "aria-label" "Import theme Shared Theme") ]
        , test "an invalid code is announced through the field description" <|
            \_ ->
                sheet (step (ThemeShareInput "not-a-theme") { owned | themeShareOpen = True })
                    |> Expect.all
                        [ Query.find [ Selector.id "theme-import-code" ]
                            >> Query.has
                                [ Selector.attribute (attr "aria-describedby" "theme-import-help theme-import-error")
                                , Selector.attribute (attr "aria-invalid" "true")
                                ]
                        , Query.find [ Selector.id "theme-import-error" ] >> Query.has [ Selector.text "That doesn't look like a valid theme code." ]
                        ]
        , test "import saves, selects and applies the theme, then closes" <|
            \_ ->
                let
                    ( next, out ) =
                        update ThemeShareImport (step (ThemeShareInput code) { owned | themeShareOpen = True })
                in
                Expect.all
                    [ \_ -> Expect.equal [ "Shared Theme" ] (List.map .name next.studioCustoms)
                    , \_ -> Expect.equal (List.map .id next.studioCustoms) [ next.themeId ]
                    , \_ -> Expect.equal False next.themeShareOpen
                    , \_ -> Expect.equal True (List.any isStoreCustoms out)
                    ]
                    ()
        , test "the copy action names the shared theme" <|
            \_ ->
                sheet { withShared | themeShareOpen = True }
                    |> Query.has [ Selector.attribute (attr "aria-label" "Copy share link for Shared Theme") ]
        , test "no share section for a built-in theme" <|
            \_ ->
                sheet { owned | themeShareOpen = True }
                    |> Query.findAll [ Selector.id "theme-share-link" ]
                    |> Query.count (Expect.equal 0)
        , test "copy writes the ?theme= link and reports success" <|
            \_ ->
                let
                    opened =
                        step ThemeShareOpen withShared

                    copied =
                        step (ClipboardResult { tag = "theme-share", ok = True }) opened
                in
                Expect.all
                    [ \_ ->
                        outs ThemeShareCopy opened
                            |> Expect.equal [ ClipboardCopy { text = "https://onyx.test?theme=" ++ code, tag = "theme-share" } ]
                    , \_ ->
                        sheet copied
                            |> Expect.all
                                [ Query.has [ Selector.text "Share link copied for Shared Theme." ]
                                , Query.find [ Selector.attribute (attr "aria-label" "Copy share link for Shared Theme") ] >> Query.has [ Selector.text "Copied" ]
                                ]
                    ]
                    ()
        , test "a copy receipt after close is ignored" <|
            \_ ->
                let
                    reopened =
                        step (ClipboardResult { tag = "theme-share", ok = True }) (step ThemeShareClose (step ThemeShareOpen withShared))
                            |> step ThemeShareOpen
                in
                Expect.equal Account2.CopyIdle reopened.themeShareCopy
        , test "Escape closes the sheet first" <|
            \_ -> Expect.equal (Just ThemeShareClose) (escapeMsg { withShared | themeShareOpen = True, youHubOpen = True })
        , test "opening from the You hub closes the hub" <|
            \_ ->
                let
                    next =
                        step ThemeShareOpen { owned | youHubOpen = True }
                in
                Expect.equal ( True, False ) ( next.themeShareOpen, next.youHubOpen )
        ]


solidDoc : String
solidDoc =
    Encode.encode 0
        (Encode.object
            [ ( "kind", Encode.string "onyx.portable-identity" )
            , ( "version", Encode.int 1 )
            , ( "exportedAt", Encode.string "2026-07-25T12:00:00.000Z" )
            , ( "networkHint", Encode.string "Onyx" )
            , ( "preferences", Encode.object [ ( "density", Encode.string "compact" ) ] )
            , ( "bookmarks", Encode.list Encode.string [ "#root", "#ROOT", "nope", "#ops" ] )
            , ( "categories", Encode.object [ ( "categories", Encode.list identity [ Encode.object [ ( "id", Encode.string "w" ), ( "name", Encode.string "Work" ), ( "channels", Encode.list Encode.string [ "#ops" ] ) ] ] ) ] )
            , ( "quietHours", Encode.object [ ( "startHour", Encode.int 23 ), ( "endHour", Encode.int 7 ) ] )
            ]
        )


validDate : String -> Bool
validDate s =
    parseIso8601Ms s /= Nothing


portableTests : Test
portableTests =
    describe "portable residence"
        [ test "round-trips non-secret residence data" <|
            \_ ->
                Account2.serializePortable { preferences = Encode.object [], bookmarks = [ "#root" ], networkHint = Just "Onyx", exportedAt = "2026-07-25T12:00:00.000Z" }
                    |> Account2.parsePortable validDate
                    |> Maybe.map (\d -> ( d.bookmarks, d.networkHint, d.quietHours ))
                    |> Expect.equal (Just ( [ "#root" ], Just "Onyx", { startHour = 22, endHour = 8 } ))
        , test "reads a Solid export: bookmarks sanitized, folders counted, quiet hours kept" <|
            \_ ->
                Account2.parsePortable validDate solidDoc
                    |> Maybe.map (\d -> ( d.bookmarks, d.folderCount, d.quietHours ))
                    |> Expect.equal (Just ( [ "#root", "#ops" ], 1, { startHour = 23, endHour = 7 } ))
        , test "refuses a wrong kind" <|
            \_ -> Expect.equal Nothing (Account2.parsePortable validDate "{\"kind\":\"nope\",\"version\":1}")
        , test "refuses a secret-bearing document" <|
            \_ ->
                Encode.encode 0 (Encode.object [ ( "kind", Encode.string "onyx.portable-identity" ), ( "version", Encode.int 1 ), ( "exportedAt", Encode.string "2026-07-25T12:00:00.000Z" ), ( "privateKey", Encode.string "evil" ) ])
                    |> Account2.parsePortable validDate
                    |> Expect.equal Nothing
        , test "refuses corrupt JSON, wrong version, bad dates and oversize input" <|
            \_ ->
                [ "{", "[]", "{\"kind\":\"onyx.portable-identity\",\"version\":2,\"exportedAt\":\"2026-07-25T12:00:00.000Z\"}", "{\"kind\":\"onyx.portable-identity\",\"version\":1,\"exportedAt\":\"yesterday\"}", String.repeat (Account2.maxPortableChars + 1) " " ]
                    |> List.map (Account2.parsePortable validDate)
                    |> Expect.equal [ Nothing, Nothing, Nothing, Nothing, Nothing ]
        , test "import replaces favorites and reports skipped folders" <|
            \_ ->
                let
                    ( next, out ) =
                        update PortableImportSubmit (step (PortableImportInput solidDoc) { account | starredChannels = Set.fromList [ "#old" ] })
                in
                Expect.all
                    [ \_ -> Expect.equal (Set.fromList [ "#root", "#ops" ]) next.starredChannels
                    , \_ -> Expect.equal [ StarredSave { channels = [ "#ops", "#root" ] } ] out
                    , \_ -> Expect.equal (Just "Imported 2 favorite(s). Room folders aren't available in this client yet, so 1 folder(s) were skipped.") next.portableStatus
                    , \_ -> Expect.equal "" next.portableImport
                    ]
                    ()
        , test "an invalid file fails closed with the oracle copy" <|
            \_ ->
                (step PortableImportSubmit (step (PortableImportInput "{}") account)).portableError
                    |> Expect.equal (Just "Invalid residence file — wrong kind, secrets present, or corrupt JSON.")
        , test "download exports the favorites without secrets" <|
            \_ ->
                case outs PortableExportDownload { account | starredChannels = Set.fromList [ "#root" ] } of
                    [ AccountDownload { filename, json } ] ->
                        Expect.all
                            [ \_ -> Expect.equal True (String.startsWith "onyx-residence-" filename && String.endsWith ".json" filename)
                            , \_ -> Expect.equal (Just [ "#root" ]) (Account2.parsePortable validDate json |> Maybe.map .bookmarks)
                            , \_ -> Expect.equal False (String.contains "password" json)
                            ]
                            ()

                    other ->
                        Expect.fail ("unexpected " ++ Debug.toString other)
        , test "export without an owner explains instead of exporting" <|
            \_ ->
                (step PortableExportDownload blank).portableError
                    |> Expect.equal (Just "Sign in before exporting residence data.")
        , test "copy receipts report into the section" <|
            \_ ->
                ( (step (ClipboardResult { tag = "portable-copy", ok = True }) account).portableStatus
                , (step (ClipboardResult { tag = "portable-copy", ok = False }) account).portableStatus
                )
                    |> Expect.equal ( Just "Residence JSON copied to clipboard.", Just "Clipboard copy failed — use Download instead." )
        , test "the account panel renders the section" <|
            \_ ->
                shell { account | accountOpen = True }
                    |> Query.has [ Selector.attribute (attr "data-testid" "portable-identity-section") ]
        ]


peopleTests : Test
peopleTests =
    let
        addFriend nick model =
            step PeopleFriendAdd (step (PeopleFriendDraft nick) model)
    in
    describe "friends and watch list"
        [ test "adding a friend persists, subscribes and clears the draft" <|
            \_ ->
                let
                    ( next, out ) =
                        update PeopleFriendAdd (step (PeopleFriendDraft "bob") owned)
                in
                Expect.all
                    [ \_ -> Expect.equal [ "bob" ] (Dict.keys next.friends)
                    , \_ -> Expect.equal "" next.peopleFriendDraft
                    , \_ ->
                        Expect.equal True
                            (List.any
                                (\o ->
                                    case o of
                                        FriendsSave _ ->
                                            True

                                        _ ->
                                            False
                                )
                                out
                            )
                    ]
                    ()
        , test "a duplicate friend keeps presence and explains" <|
            \_ ->
                let
                    online =
                        setFriendOnline (addFriend "bob" owned) "bob" True

                    again =
                        addFriend "Bob" online
                in
                Expect.equal ( Just True, Just "Bob is already a friend." ) ( Dict.get "bob" again.friends |> Maybe.map .online, again.peopleNotice )
        , test "an invalid name is refused with a reason" <|
            \_ -> Expect.equal (Just "Enter a valid name.") (addFriend "bad name!" owned).peopleNotice
        , test "no device-memory owner refuses with a reason" <|
            \_ -> Expect.equal (Just "Connect first to keep a list of people.") (addFriend "bob" blank).peopleNotice
        , test "removing a friend persists the smaller list" <|
            \_ -> Expect.equal [] (Dict.keys (step (PeopleFriendRemove "bob") (addFriend "bob" owned)).friends)
        , test "watch add and remove" <|
            \_ ->
                let
                    watched =
                        step PeopleWatchAdd (step (PeopleWatchDraft "carol") owned)
                in
                Expect.equal ( [ "carol" ], [] ) ( List.map .nick watched.watchList, List.map .nick (step (PeopleWatchRemove "carol") watched).watchList )
        , test "the sheet lists online friends first with presence in words" <|
            \_ ->
                let
                    model =
                        setFriendOnline (addFriend "zed" (addFriend "amy" owned)) "zed" True
                in
                render (View.Account2.peopleSheet { model | peopleOpen = True })
                    |> Query.find [ Selector.attribute (attr "aria-label" "Friends") ]
                    |> Query.children []
                    |> Query.first
                    |> Query.has [ Selector.text "zed", Selector.text "Online" ]
        , test "Message closes the sheet" <|
            \_ -> Expect.equal False (step (PeopleMessage "bob") { owned | peopleOpen = True }).peopleOpen
        , test "Escape closes People" <|
            \_ -> Expect.equal (Just PeopleClose) (escapeMsg { owned | peopleOpen = True })
        , test "the You hub offers People and theme share" <|
            \_ ->
                shell { owned | youHubOpen = True }
                    |> Query.has [ Selector.attribute (attr "data-testid" "you-open-people"), Selector.attribute (attr "data-testid" "you-open-theme-share") ]
        , test "a friend's presence rides the DM row label" <|
            \_ ->
                let
                    model =
                        setFriendOnline (addFriend "bob" owned) "bob" True
                in
                ( View.Account2.friendPresenceLabel model "Bob", View.Account2.friendPresenceLabel model "eve" )
                    |> Expect.equal ( ", friend, online", "" )
        , test "watch last-seen copy" <|
            \_ ->
                [ Account2.lastSeenLabel Nothing 0, Account2.lastSeenLabel (Just 0) 30000, Account2.lastSeenLabel (Just 0) (5 * 60000), Account2.lastSeenLabel (Just 0) (3 * 3600000) ]
                    |> Expect.equal [ "Not seen yet", "Last seen just now", "Last seen 5m ago", "Last seen 3h ago" ]
        ]


statusTests : Test
statusTests =
    describe "custom status, presence and DND"
        [ test "save lands the status and its expiry" <|
            \_ ->
                let
                    ( next, out ) =
                        owned
                            |> step StatusEditStart
                            |> step (StatusEditInput "Coding")
                            |> step (StatusExpiryChoose "30m")
                            |> update StatusEditSave
                in
                Expect.all
                    [ \_ -> Expect.equal "Coding" next.customStatus
                    , \_ -> Expect.equal (Just (owned.nowMs + 30 * 60000)) next.customStatusExpiry
                    , \_ -> Expect.equal Nothing next.statusEditing
                    , \_ ->
                        List.filterMap
                            (\o ->
                                case o of
                                    IdentityProfileSave save ->
                                        Just ( save.status, save.expiryIso /= Nothing )

                                    _ ->
                                        Nothing
                            )
                            out
                            |> List.reverse
                            |> List.head
                            |> Expect.equal (Just ( "Coding", True ))
                    ]
                    ()
        , test "control characters are refused with a reason" <|
            \_ ->
                (owned |> step StatusEditStart |> step (StatusEditInput "a\u{0007}b") |> step StatusEditSave).statusError
                    |> Expect.notEqual Nothing
        , test "clear wipes the status and its expiry" <|
            \_ ->
                let
                    set =
                        owned |> step StatusEditStart |> step (StatusEditInput "Away") |> step (StatusExpiryChoose "1h") |> step StatusEditSave

                    cleared =
                        step StatusClear set
                in
                Expect.equal ( "", Nothing ) ( cleared.customStatus, cleared.customStatusExpiry )
        , test "expiry copy" <|
            \_ ->
                [ Account2.expiryLabel Nothing 0, Account2.expiryLabel (Just 600000) 0, Account2.expiryLabel (Just (3 * 3600000)) 0, Account2.expiryLabel (Just 1) 2 ]
                    |> Expect.equal [ "", "Clears in 10 min", "Clears in 3 h", "Expired" ]
        , test "unknown expiry ids never clear" <|
            \_ -> Expect.equal ( Nothing, Nothing ) ( Account2.expiryFor "never" 0, Account2.expiryFor "bogus" 0 )
        , test "the You hub shows the status block and a DND badge" <|
            \_ ->
                shell { owned | youHubOpen = True, userStatus = StatusDnd, customStatus = "Heads down" }
                    |> Query.find [ Selector.attribute (attr "data-testid" "you-status") ]
                    |> Query.has [ Selector.text "Heads down", Selector.text "Do not disturb" ]
        , test "an expired status reads as unset" <|
            \_ ->
                shell { owned | youHubOpen = True, customStatus = "Lunch", customStatusExpiry = Just 1 }
                    |> Query.find [ Selector.attribute (attr "data-testid" "you-custom-status") ]
                    |> Query.has [ Selector.text "No status set" ]
        , test "notification DND shows as paused" <|
            \_ ->
                shell { owned | youHubOpen = True, dndEnabled = True }
                    |> Query.find [ Selector.attribute (attr "data-testid" "you-dnd") ]
                    |> Query.has [ Selector.text "Notifications paused" ]
        ]


attr : String -> String -> Html.Attribute Never
attr name value =
    Html.Attributes.attribute name value


isStoreCustoms : Outbound -> Bool
isStoreCustoms o =
    case o of
        StudioStoreCustomThemes _ ->
            True

        _ ->
            False

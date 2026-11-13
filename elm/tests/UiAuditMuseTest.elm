module UiAuditMuseTest exposing (suite)

{-| UI audit (MUSE lane): theme contrast for every built-in look,
autocomplete tokens, field/error wiring, and arm-then-confirm for
two-factor disable and local session sign-out.
-}

import App exposing (..)
import Char
import ConnectGate
import Dict
import Expect
import Html.Attributes as Attr
import RuntimeDomain
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import ThemeTokens
import View.Account
import View.Appearance
import View.Connect
import View.Connection


-- Contrast helpers (WCAG 2.x relative luminance)


hexVal : Char -> Int
hexVal c =
    if Char.isDigit c then
        Char.toCode c - Char.toCode '0'

    else
        Char.toCode (Char.toLower c) - Char.toCode 'a' + 10


parseHex : String -> Maybe ( Int, Int, Int )
parseHex raw =
    case String.toList (String.dropLeft 1 raw) of
        [ a, b, c, d, e, f ] ->
            Just
                ( hexVal a * 16 + hexVal b
                , hexVal c * 16 + hexVal d
                , hexVal e * 16 + hexVal f
                )

        _ ->
            Nothing


channel : Int -> Float
channel value =
    let
        s =
            toFloat value / 255
    in
    if s <= 0.03928 then
        s / 12.92

    else
        ((s + 0.055) / 1.055) ^ 2.4


luminance : ( Int, Int, Int ) -> Float
luminance ( r, g, b ) =
    0.2126 * channel r + 0.7152 * channel g + 0.0722 * channel b


contrast : ( Int, Int, Int ) -> ( Int, Int, Int ) -> Float
contrast a b =
    let
        la =
            luminance a

        lb =
            luminance b
    in
    (max la lb + 0.05) / (min la lb + 0.05)


mix : ( Int, Int, Int ) -> ( Int, Int, Int ) -> ( Int, Int, Int )
mix ( r1, g1, b1 ) ( r2, g2, b2 ) =
    ( round (0.7 * toFloat r1 + 0.3 * toFloat r2)
    , round (0.7 * toFloat g1 + 0.3 * toFloat g2)
    , round (0.7 * toFloat b1 + 0.3 * toFloat b2)
    )


token : String -> String -> Maybe ( Int, Int, Int )
token look key =
    Dict.get key (ThemeTokens.tokensFor look) |> Maybe.andThen parseHex


lookFailures : String -> List String
lookFailures look =
    let
        mute =
            token look "--paper-mute"

        dim =
            token look "--paper-dim"

        paper =
            token look "--paper"

        stone =
            token look "--stone"

        stone2 =
            token look "--stone-2"

        stoneLine =
            token look "--stone-line"

        check label threshold fg bg =
            case ( fg, bg ) of
                ( Just f, Just bk ) ->
                    if contrast f bk >= threshold then
                        []

                    else
                        [ look ++ " " ++ label ++ " " ++ String.fromFloat (contrast f bk) ]

                _ ->
                    [ look ++ " missing token for " ++ label ]

        lineStrong =
            Maybe.map2 mix stoneLine paper

        dimmer =
            case ( mute, dim, stone ) of
                ( Just m, Just d, Just s ) ->
                    if contrast m s < contrast d s then
                        []

                    else
                        [ look ++ " faint not dimmer than dim" ]

                _ ->
                    [ look ++ " missing token for dimmer" ]
    in
    check "faint-on-stone" 4.5 mute stone
        ++ check "faint-on-stone-2" 4.5 mute stone2
        ++ check "dim-on-stone" 4.5 dim stone
        ++ check "dim-on-stone-2" 4.5 dim stone2
        ++ check "line-strong-on-stone" 3.0 lineStrong stone
        ++ check "line-strong-on-stone-2" 3.0 lineStrong stone2
        ++ dimmer


-- Session inventory fixtures


localRow : String -> Int -> Bool -> RuntimeDomain.SessionLocalRow
localRow ref index current =
    { rowRef = ref, index = index, signonMs = "1710000000", state = "detached", current = current }


inventoryOf : List RuntimeDomain.SessionLocalRow -> RuntimeDomain.SessionInventoryView
inventoryOf rows =
    { requestId = "sessionList_request_00000001"
    , mode = "local"
    , status = "ready"
    , scanRef = Nothing
    , localRows = rows
    , meshRows = []
    , continuationAvailable = False
    , scanComplete = True
    , pageCount = 0
    , lastObservedAt = Nothing
    , reason = Nothing
    }


liveAccount : List RuntimeDomain.SessionLocalRow -> Model
liveAccount rows =
    { blank
        | connection = Live
        , accountName = Just "alice"
        , runtimeOwnerStamp =
            Just
                { ownerRef = "test_owner_000000000000000000000000"
                , networkId = "test_network"
                , accountId = Just "alice"
                , accountGeneration = 1
                , connectionGeneration = 1
                }
        , sessionInventoryView = Just (inventoryOf rows)
    }


droppedRefs : List Outbound -> List String
droppedRefs outs =
    List.filterMap
        (\o ->
            case o of
                RuntimeDomainCommand command ->
                    case command.action of
                        RuntimeDomain.LocalSessionDrop ref ->
                            Just ref

                        _ ->
                            Nothing

                _ ->
                    Nothing
        )
        outs


passkey : String -> String -> RuntimeDomain.PasskeyRow
passkey ref label =
    { credentialRef = ref, label = label, signCount = "0", createdUnix = "1794528000" }


-- View helpers


radiogroup : String -> Query.Single Msg -> Query.Single Msg
radiogroup name q =
    q |> Query.find [ Selector.attribute (Attr.attribute "role" "radiogroup"), Selector.attribute (Attr.attribute "aria-label" name) ]


themeGroupChecks : String -> List (Query.Single Msg -> Expect.Expectation)
themeGroupChecks themeLabel =
    [ \q -> radiogroup "Look" q |> Query.findAll [ Selector.attribute (Attr.tabindex 0) ] |> Query.count (Expect.equal 1)
    , \q -> radiogroup "All looks" q |> Query.findAll [ Selector.attribute (Attr.tabindex 0) ] |> Query.count (Expect.equal 1)
    , \q ->
        -- the active theme renders once, checked, in exactly one group
        let
            checkedIn name =
                radiogroup name q
                    |> Query.findAll [ Selector.attribute (Attr.attribute "role" "radio"), Selector.attribute (Attr.attribute "aria-checked" "true"), Selector.containing [ Selector.text themeLabel ] ]
        in
        Expect.all
            [ \_ -> checkedIn "Look" |> Query.count (\n -> checkedIn "All looks" |> Query.count (\m -> Expect.equal 1 (n + m)))
            , \_ ->
                radiogroup "Look" q
                    |> Query.findAll [ Selector.attribute (Attr.attribute "aria-checked" "true") ]
                    |> Query.count (\n -> radiogroup "All looks" q |> Query.findAll [ Selector.attribute (Attr.attribute "aria-checked" "true") ] |> Query.count (\m -> Expect.equal 1 (n + m)))
            ]
            ()
    ]


accountQuery : Model -> Query.Single Msg
accountQuery model =
    View.Account.accountPanel
        { model | accountName = Just "kai", ourNick = "kai", accountOpen = True }
        |> Query.fromHtml


suite : Test
suite =
    describe "UI audit (MUSE lane)"
        [ describe "theme contrast"
            [ test "faint, dim and field-border tokens pass on every look" <|
                \_ ->
                    List.concatMap lookFailures ThemeTokens.themeIds
                        |> Expect.equal []
            , test "frost accent passes on its panels" <|
                \_ ->
                    let
                        accent =
                            token "frost" "--lapis-bright"

                        stone =
                            token "frost" "--stone"

                        stone2 =
                            token "frost" "--stone-2"
                    in
                    case ( accent, stone, stone2 ) of
                        ( Just a, Just s, Just s2 ) ->
                            Expect.all
                                [ \_ -> Expect.atLeast 4.5 (contrast a s)
                                , \_ -> Expect.atLeast 4.5 (contrast a s2)
                                ]
                                ()

                        _ ->
                            Expect.fail "frost tokens missing"
            ]
        , describe "account autocomplete"
            [ test "email and password fields carry autocomplete and name" <|
                \_ ->
                    let
                        q =
                            accountQuery blank
                    in
                    Expect.all
                        [ \_ ->
                            q
                                |> Query.find [ Selector.id "acct-email" ]
                                |> Query.has
                                    [ Selector.attribute (Attr.attribute "autocomplete" "email")
                                    , Selector.attribute (Attr.attribute "name" "email")
                                    ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.id "acct-email-password" ]
                                |> Query.has [ Selector.attribute (Attr.attribute "autocomplete" "current-password") ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.id "acct-new-password" ]
                                |> Query.has [ Selector.attribute (Attr.attribute "autocomplete" "new-password") ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.id "acct-confirm-password" ]
                                |> Query.has [ Selector.attribute (Attr.attribute "autocomplete" "new-password") ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.id "acct-current-password" ]
                                |> Query.has [ Selector.attribute (Attr.attribute "autocomplete" "current-password") ]
                        ]
                        ()
            , test "totp code field is a one-time-code numeric field" <|
                \_ ->
                    accountQuery { blank | totp = { blankTotp | status = TotpPending } }
                        |> Query.find [ Selector.id "acct-totp-code" ]
                        |> Query.has
                            [ Selector.attribute (Attr.attribute "autocomplete" "one-time-code")
                            , Selector.attribute (Attr.attribute "inputmode" "numeric")
                            ]
            ]
        , describe "form errors tied to fields"
            [ test "email error marks fields invalid and describedby the error" <|
                \_ ->
                    let
                        q =
                            accountQuery { blank | accountEmailError = Just "bad email" }
                    in
                    Expect.all
                        [ \_ ->
                            q
                                |> Query.find [ Selector.id "acct-email" ]
                                |> Query.has
                                    [ Selector.attribute (Attr.attribute "aria-invalid" "true")
                                    , Selector.attribute (Attr.attribute "aria-describedby" "acct-email-error")
                                    ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.id "acct-email-error" ]
                                |> Query.has [ Selector.text "bad email" ]
                        ]
                        ()
            , test "password error marks password fields invalid" <|
                \_ ->
                    accountQuery { blank | accountPasswordError = Just "mismatch" }
                        |> Query.find [ Selector.id "acct-new-password" ]
                        |> Query.has
                            [ Selector.attribute (Attr.attribute "aria-invalid" "true")
                            , Selector.attribute (Attr.attribute "aria-describedby" "acct-password-error")
                            ]
            , test "totp error marks the code field invalid" <|
                \_ ->
                    accountQuery { blank | totp = { blankTotp | status = TotpPending, error = Just "bad code" } }
                        |> Query.find [ Selector.id "acct-totp-code" ]
                        |> Query.has
                            [ Selector.attribute (Attr.attribute "aria-invalid" "true")
                            , Selector.attribute (Attr.attribute "aria-describedby" "acct-totp-error")
                            ]
            , test "no error means no aria-invalid" <|
                \_ ->
                    accountQuery blank
                        |> Query.find [ Selector.id "acct-email" ]
                        |> Query.hasNot [ Selector.attribute (Attr.attribute "aria-invalid" "true") ]
            , test "sessions error is an alert" <|
                \_ ->
                    accountQuery { blank | accountSessionsError = Just "no sessions" }
                        |> Query.find [ Selector.id "account-sessions-error" ]
                        |> Query.has
                            [ Selector.attribute (Attr.attribute "role" "alert")
                            , Selector.text "no sessions"
                            ]
            , test "connect gate error describes the name field" <|
                \_ ->
                    let
                        gate0 =
                            ConnectGate.arm
                    in
                    View.Connect.gate blank { gate0 | error = Just "nope" }
                        |> Query.fromHtml
                        |> Query.find [ Selector.id "connect-name" ]
                        |> Query.has
                            [ Selector.attribute (Attr.attribute "aria-invalid" "true")
                            , Selector.attribute (Attr.attribute "aria-describedby" "connect-name-hint connect-error")
                            ]
            , test "connection dialog error has an id and describes fields" <|
                \_ ->
                    let
                        q =
                            View.Connection.dialog
                                { blank
                                    | connectionDialogOpen = True
                                    , connectionDialogError = Just "bad sign-in"
                                    , connectionSignIn = True
                                }
                                |> Query.fromHtml
                    in
                    Expect.all
                        [ \_ ->
                            q
                                |> Query.find [ Selector.id "connection-error" ]
                                |> Query.has [ Selector.text "bad sign-in" ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.id "connection-account" ]
                                |> Query.has
                                    [ Selector.attribute (Attr.attribute "aria-invalid" "true")
                                    , Selector.attribute (Attr.attribute "aria-describedby" "connection-error")
                                    ]
                        ]
                        ()
            ]
        , describe "arm then confirm"
            [ test "arming totp disable does not send anything and focuses confirm" <|
                \_ ->
                    let
                        ( next, outs ) =
                            update TotpDisableArmed blank
                    in
                    Expect.all
                        [ \_ -> Expect.equal True next.totpDisableArmed
                        , \_ -> Expect.equal [ FocusElement "account-totp-disable-confirm" ] outs
                        ]
                        ()
            , test "confirming totp disable sends the disable line and disarms" <|
                \_ ->
                    let
                        armed =
                            { blank
                                | accountName = Just "kai"
                                , connection = Live
                                , totpDisableArmed = True
                                , totp = { blankTotp | status = TotpActive }
                            }

                        ( next, outs ) =
                            update TotpDisableConfirmed armed

                        sent =
                            List.filterMap
                                (\o ->
                                    case o of
                                        SendLine line ->
                                            Just line

                                        _ ->
                                            Nothing
                                )
                                outs
                    in
                    Expect.all
                        [ \_ -> Expect.equal False next.totpDisableArmed
                        , \_ -> Expect.equal 1 (List.length sent)
                        ]
                        ()
            , test "cancelling totp disable disarms without effects" <|
                \_ ->
                    update TotpDisableCancelled { blank | totpDisableArmed = True }
                        |> Expect.equal ( { blank | totpDisableArmed = False }, [ FocusElement "account-totp-disable" ] )
            , test "armed totp view offers confirm wired to TotpDisableConfirmed" <|
                \_ ->
                    accountQuery
                        { blank
                            | totpDisableArmed = True
                            , totp = { blankTotp | status = TotpActive }
                        }
                        |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-totp-disable-confirm") ]
                        |> Event.simulate Event.click
                        |> Event.expect TotpDisableConfirmed
            , test "arming a session drop focuses its confirm and cancel disarms" <|
                \_ ->
                    let
                        ( armed, outs ) =
                            update (SessionDropArmed { rowRef = "local_row_reference_000003" }) blank

                        ( cancelled, cancelOuts ) =
                            update SessionDropCancelled armed
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just "local_row_reference_000003") armed.sessionDropArmed
                        , \_ -> Expect.equal [ FocusElement "account-session-drop-confirm" ] outs
                        , \_ -> Expect.equal Nothing cancelled.sessionDropArmed
                        , \_ -> Expect.equal [] cancelOuts
                        ]
                        ()
            ]
        , describe "session drop confirm resolves by opaque ref"
            [ test "confirming an armed row drops that row's ref and disarms" <|
                \_ ->
                    let
                        ( armed, _ ) =
                            update (SessionDropArmed { rowRef = "local_row_reference_000003" })
                                (liveAccount [ localRow "local_row_reference_000001" 1 True, localRow "local_row_reference_000003" 3 False ])

                        ( next, outs ) =
                            update SessionDropConfirmed armed
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ "local_row_reference_000003" ] (droppedRefs outs)
                        , \_ -> Expect.equal Nothing next.sessionDropArmed
                        ]
                        ()
            , test "a replaced inventory never retargets the confirm onto another row" <|
                \_ ->
                    let
                        ( armed, _ ) =
                            update (SessionDropArmed { rowRef = "local_row_reference_000003" })
                                (liveAccount [ localRow "local_row_reference_000003" 3 False ])

                        -- server renumbers: index 3 is now a different session
                        replaced =
                            { armed | sessionInventoryView = Just (inventoryOf [ localRow "local_row_reference_000009" 3 False ]) }

                        ( next, outs ) =
                            update SessionDropConfirmed replaced
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] (droppedRefs outs)
                        , \_ -> Expect.equal Nothing next.sessionDropArmed
                        , \_ -> Expect.equal (Just "Refresh the session list before selecting a session to sign out.") next.accountSessionsError
                        ]
                        ()
            , test "a renumbered but still-present row is dropped by its ref" <|
                \_ ->
                    let
                        ( armed, _ ) =
                            update (SessionDropArmed { rowRef = "local_row_reference_000003" })
                                (liveAccount [ localRow "local_row_reference_000003" 3 False ])

                        replaced =
                            { armed | sessionInventoryView = Just (inventoryOf [ localRow "local_row_reference_000009" 3 False, localRow "local_row_reference_000003" 5 False ]) }

                        ( _, outs ) =
                            update SessionDropConfirmed replaced
                    in
                    Expect.equal [ "local_row_reference_000003" ] (droppedRefs outs)
            , test "armed view confirm is wired to SessionDropConfirmed for the armed row only" <|
                \_ ->
                    let
                        model =
                            liveAccount [ localRow "local_row_reference_000002" 2 False, localRow "local_row_reference_000003" 3 False ]
                    in
                    Expect.all
                        [ \_ ->
                            accountQuery { model | sessionDropArmed = Just "local_row_reference_000003" }
                                |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-session-drop-confirm") ]
                                |> Event.simulate Event.click
                                |> Event.expect SessionDropConfirmed
                        , \_ ->
                            accountQuery { model | sessionDropArmed = Just "local_row_reference_000003" }
                                |> Query.find [ Selector.id "account-session-drop-2" ]
                                |> Event.simulate Event.click
                                |> Event.expect (SessionDropArmed { rowRef = "local_row_reference_000002" })
                        ]
                        ()
            , test "cancel returns focus to the row's sign-out trigger" <|
                \_ ->
                    update SessionDropCancelled
                        { blank
                            | sessionDropArmed = Just "local_row_reference_000003"
                            , sessionInventoryView = Just (inventoryOf [ localRow "local_row_reference_000003" 3 False ])
                        }
                        |> Tuple.second
                        |> Expect.equal [ FocusElement "account-session-drop-3" ]
            , test "closing the account panel clears every arm" <|
                \_ ->
                    let
                        ( next, _ ) =
                            update (SetAccountOpen False)
                                { blank
                                    | accountOpen = True
                                    , totpDisableArmed = True
                                    , sessionDropArmed = Just "local_row_reference_000003"
                                    , passkeyRemoveArmed = Just "credential_ref"
                                }
                    in
                    Expect.equal ( False, Nothing, Nothing ) ( next.totpDisableArmed, next.sessionDropArmed, next.passkeyRemoveArmed )
            ]
        , describe "account sections and names"
            [ test "section-nav targets can take focus" <|
                \_ ->
                    let
                        q =
                            accountQuery blank
                    in
                    Expect.all
                        (List.map
                            (\target ->
                                \_ ->
                                    q
                                        |> Query.find [ Selector.id target ]
                                        |> Query.has [ Selector.attribute (Attr.tabindex -1) ]
                            )
                            [ "acct-identity", "acct-email-title", "acct-password-title", "acct-recovery-title", "acct-sessions-title", "acct-session-title" ]
                        )
                        ()
            , test "same-label same-day passkeys get distinct accessible names" <|
                \_ ->
                    let
                        model =
                            { blank
                                | passkeyManagementView =
                                    Just { requestId = "passkeyList_request_000001", status = "ready", operation = Nothing, rows = [ passkey "cred_a" "Key", passkey "cred_b" "Key" ], reason = Nothing }
                            }

                        q =
                            accountQuery model
                    in
                    Expect.all
                        [ \_ -> q |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Remove Key (added 2026-11-13), passkey 1") ]
                        , \_ -> q |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Remove Key (added 2026-11-13), passkey 2") ]
                        ]
                        ()
            , test "chat-name field is not tied to an IDENTIFY sign-in error" <|
                \_ ->
                    View.Connection.dialog
                        { blank
                            | connectionDialogOpen = True
                            , connectionSignIn = False
                            , accountActionError = Just { command = "IDENTIFY", code = "FAIL", description = "bad password" }
                        }
                        |> Query.fromHtml
                        |> Query.find [ Selector.id "connection-nick" ]
                        |> Query.hasNot [ Selector.attribute (Attr.attribute "aria-invalid" "true") ]
            ]
        , describe "appearance look groups"
            [ test "ocean active: one tab stop per radiogroup, ocean checked once" <|
                \_ ->
                    Expect.all (themeGroupChecks "Ocean · Dark") (View.Appearance.view { blank | themeId = "ocean" } |> Query.fromHtml)
            , test "tide active: one tab stop per radiogroup, tide checked once" <|
                \_ ->
                    Expect.all (themeGroupChecks "Ocean · Tide") (View.Appearance.view { blank | themeId = "tide" } |> Query.fromHtml)
            , test "the Look group keeps only its fixed looks when an extra look is active" <|
                \_ ->
                    View.Appearance.view { blank | themeId = "tide" }
                        |> Query.fromHtml
                        |> radiogroup "Look"
                        |> Query.findAll [ Selector.attribute (Attr.attribute "role" "radio") ]
                        |> Query.count (Expect.equal 3)
            , test "an extra look is named in the main Look section without becoming a radio" <|
                \_ ->
                    let
                        q =
                            View.Appearance.view { blank | themeId = "tide" } |> Query.fromHtml

                        current =
                            q |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "appearance-current-look") ]
                    in
                    Expect.all
                        [ \_ -> current |> Query.has [ Selector.text "Current look: ", Selector.text "Ocean · Tide", Selector.text " (chosen under Advanced, All looks)" ]
                        , \_ -> current |> Query.findAll [ Selector.attribute (Attr.attribute "role" "radio") ] |> Query.count (Expect.equal 0)
                        , \_ -> current |> Query.findAll [ Selector.attribute (Attr.tabindex 0) ] |> Query.count (Expect.equal 0)
                        ]
                        ()
            , test "the current-look line stays put for a main look" <|
                \_ ->
                    View.Appearance.view { blank | themeId = "ocean" }
                        |> Query.fromHtml
                        |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "appearance-current-look") ]
                        |> Query.has [ Selector.text "Ocean · Dark" ]
            ]
        , describe "appearance wiring"
            [ test "quiet-hours and translation selects have linked labels" <|
                \_ ->
                    let
                        q =
                            View.Appearance.view { blank | translationAvailable = True }
                                |> Query.fromHtml
                    in
                    Expect.all
                        [ \_ -> q |> Query.has [ Selector.id "ap-quiet-start" ]
                        , \_ -> q |> Query.has [ Selector.id "ap-quiet-end" ]
                        , \_ -> q |> Query.has [ Selector.id "ap-translation-language" ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.tag "label", Selector.attribute (Attr.for "ap-translation-language") ]
                                |> Query.has [ Selector.text "Translation language" ]
                        ]
                        ()
            , test "switches are labelled by visible text, not On/Off" <|
                \_ ->
                    let
                        q =
                            View.Appearance.view blank |> Query.fromHtml
                    in
                    Expect.all
                        [ \_ ->
                            q
                                |> Query.find [ Selector.attribute (Attr.attribute "aria-labelledby" "ap-reduce-motion-label") ]
                                |> Query.has [ Selector.attribute (Attr.attribute "role" "switch") ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.attribute (Attr.attribute "aria-labelledby" "ap-privacy-e2eeDms-label") ]
                                |> Query.has [ Selector.attribute (Attr.attribute "aria-describedby" "ap-privacy-e2eeDms-hint") ]
                        ]
                        ()
            ]
        ]

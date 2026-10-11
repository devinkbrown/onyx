module GapAccountViewTest exposing (suite)

{-| v3/gap-account — what the Account → Protection / Names sections and
the Preferences data cards show, and which Msg each control sends. The
folds themselves are in `GapAccountAppTest`.
-}

import App exposing (..)
import Dict
import Expect
import GapAccount
import Html
import Html.Attributes
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View.GapAccount


account : Model
account =
    { blank | endpoint = Just "wss://onyx.test/ws", ourNick = "me", accountName = Just "kai", connection = Live }


withInfo : Maybe Int -> Model -> Model
withInfo flags model =
    { model
        | accountInfo =
            Just { account = "kai", flags = flags, email = Nothing, secure = Nothing, enforce = Nothing, registered = Nothing }
    }


withGap : (GapAccount.State -> GapAccount.State) -> Model -> Model
withGap f model =
    { model | gapAccount = f model.gapAccount }


one : Html.Html Msg -> Query.Single Msg
one html =
    Query.fromHtml (Html.div [] [ html ])


many : List (Html.Html Msg) -> Query.Single Msg
many htmls =
    Query.fromHtml (Html.div [] htmls)


switchOf : String -> Query.Single Msg -> Query.Single Msg
switchOf key =
    Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" ("account-protect-" ++ key)) ]


suite : Test
suite =
    describe "v3/gap-account views"
        [ describe "Protection"
            [ test "the switches show the server's flags (16 = secure, 8 = enforce off)" <|
                \_ ->
                    let
                        view flags =
                            one (View.GapAccount.protectionSection (withInfo flags account))
                    in
                    Expect.all
                        [ \_ -> view (Just 0) |> switchOf "secure" |> Query.has [ Selector.attribute (Html.Attributes.attribute "aria-checked" "false") ]
                        , \_ -> view (Just 0) |> switchOf "enforce" |> Query.has [ Selector.attribute (Html.Attributes.attribute "aria-checked" "true") ]
                        , \_ -> view (Just 24) |> switchOf "secure" |> Query.has [ Selector.attribute (Html.Attributes.attribute "aria-checked" "true") ]
                        , \_ -> view (Just 24) |> switchOf "enforce" |> Query.has [ Selector.attribute (Html.Attributes.attribute "aria-checked" "false") ]
                        ]
                        ()
            , test "before ACCOUNTINFO answers the state is unknown, the switches are disabled and say so" <|
                \_ ->
                    let
                        view =
                            one (View.GapAccount.protectionSection account)
                    in
                    Expect.all
                        [ \_ -> view |> switchOf "secure" |> Query.has [ Selector.attribute (Html.Attributes.attribute "aria-checked" "mixed"), Selector.disabled True ]
                        , \_ -> view |> Query.has [ Selector.text "Current settings haven't loaded yet." ]
                        ]
                        ()
            , test "a switch sends its toggle with the opposite value" <|
                \_ ->
                    one (View.GapAccount.protectionSection (withInfo (Just 0) account))
                        |> switchOf "secure"
                        |> Event.simulate Event.click
                        |> Event.expect (GapAccountMsg (GapAccount.ProtectToggle "secure" True))
            , test "the switches are disabled while saving and while offline" <|
                \_ ->
                    let
                        saving =
                            withGap (\g -> { g | protectPending = Just { field = "secure", on = True } }) (withInfo (Just 0) account)

                        offline =
                            withInfo (Just 0) { account | connection = Offline }
                    in
                    Expect.all
                        [ \_ -> one (View.GapAccount.protectionSection saving) |> switchOf "secure" |> Query.has [ Selector.disabled True ]
                        , \_ -> one (View.GapAccount.protectionSection saving) |> Query.has [ Selector.text "Saving…" ]
                        , \_ -> one (View.GapAccount.protectionSection offline) |> switchOf "enforce" |> Query.has [ Selector.disabled True ]
                        ]
                        ()
            , test "the password field is a password input and its value is the typed secret only until sent" <|
                \_ ->
                    let
                        typed =
                            withGap (\g -> { g | protectPassword = "hunter22" }) (withInfo (Just 0) account)
                    in
                    one (View.GapAccount.protectionSection typed)
                        |> Query.find [ Selector.id "acct-protect-password" ]
                        |> Query.has [ Selector.attribute (Html.Attributes.attribute "type" "password"), Selector.attribute (Html.Attributes.attribute "autocomplete" "current-password") ]
            , test "errors are announced as alerts, notices as status" <|
                \_ ->
                    let
                        failing =
                            withGap (\g -> { g | protectError = Just "That password didn't match. Nothing was changed.", protectNotice = Just "Saved." }) (withInfo (Just 0) account)

                        view =
                            one (View.GapAccount.protectionSection failing)
                    in
                    Expect.all
                        [ \_ -> view |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "account-protect-error") ] |> Query.has [ Selector.attribute (Html.Attributes.attribute "role" "alert") ]
                        , \_ -> view |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "account-protect-notice") ] |> Query.has [ Selector.attribute (Html.Attributes.attribute "role" "status") ]
                        ]
                        ()
            , test "Recover a name: Take it back submits, Release hold sends its own message, both disabled while pending" <|
                \_ ->
                    let
                        view model =
                            one (View.GapAccount.protectionSection model)

                        pending =
                            withGap (\g -> { g | recoverPending = Just { verb = "RECOVER", nick = "kai" } }) account
                    in
                    Expect.all
                        [ \_ ->
                            view account
                                |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "account-release") ]
                                |> Event.simulate Event.click
                                |> Event.expect (GapAccountMsg GapAccount.ReleaseSubmit)
                        , \_ ->
                            view account
                                |> Query.find [ Selector.tag "form", Selector.attribute (Html.Attributes.attribute "aria-label" "Recover a name") ]
                                |> Event.simulate Event.submit
                                |> Event.expect (GapAccountMsg GapAccount.RecoverSubmit)
                        , \_ -> view pending |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "account-recover") ] |> Query.has [ Selector.disabled True ]
                        , \_ -> view pending |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "account-release") ] |> Query.has [ Selector.disabled True ]
                        ]
                        ()
            ]
        , describe "Names"
            [ test "empty lists say so" <|
                \_ ->
                    one (View.GapAccount.namesSection account)
                        |> Query.has [ Selector.text "No recognised addresses.", Selector.text "No grouped names yet." ]
            , test "each recognised address has a labelled Remove" <|
                \_ ->
                    let
                        m =
                            withGap (\g -> { g | recognize = [ "kai!*@home.example" ] }) account
                    in
                    one (View.GapAccount.namesSection m)
                        |> Query.find [ Selector.attribute (Html.Attributes.attribute "aria-label" "Remove kai!*@home.example") ]
                        |> Event.simulate Event.click
                        |> Event.expect (GapAccountMsg (GapAccount.RecognizeRemove "kai!*@home.example"))
            , test "the primary name offers neither Make primary nor Remove; others offer both" <|
                \_ ->
                    let
                        m =
                            withGap (\g -> { g | groupNicks = [ { nick = "kai", primary = True }, { nick = "kai-away", primary = False } ] }) account

                        view =
                            one (View.GapAccount.namesSection m)
                    in
                    Expect.all
                        [ \_ -> view |> Query.findAll [ Selector.attribute (Html.Attributes.attribute "aria-label" "Remove kai from your group") ] |> Query.count (Expect.equal 0)
                        , \_ -> view |> Query.findAll [ Selector.attribute (Html.Attributes.attribute "aria-label" "Make kai primary") ] |> Query.count (Expect.equal 0)
                        , \_ -> view |> Query.has [ Selector.attribute (Html.Attributes.attribute "aria-label" "Make kai-away primary") ]
                        , \_ ->
                            view
                                |> Query.find [ Selector.attribute (Html.Attributes.attribute "aria-label" "Remove kai-away from your group") ]
                                |> Event.simulate Event.click
                                |> Event.expect (GapAccountMsg (GapAccount.GroupRemove "kai-away"))
                        ]
                        ()
            , test "controls are disabled offline" <|
                \_ ->
                    let
                        m =
                            withGap (\g -> { g | recognize = [ "x!*@y" ] }) { account | connection = Offline }
                    in
                    one (View.GapAccount.namesSection m)
                        |> Query.find [ Selector.attribute (Html.Attributes.attribute "aria-label" "Remove x!*@y") ]
                        |> Query.has [ Selector.disabled True ]
            , test "the section nav lists both sections" <|
                \_ ->
                    many View.GapAccount.accountNavLinks
                        |> Query.has [ Selector.text "Protection", Selector.text "Names" ]
            ]
        , describe "History & data"
            [ test "the local-history switch reflects the preference and sends its flip" <|
                \_ ->
                    let
                        on =
                            many (View.GapAccount.historyCards account)

                        prefs =
                            account.prefs

                        off =
                            many (View.GapAccount.historyCards { account | prefs = { prefs | localHistory = False } })

                        find q =
                            q |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "pref-toggle-localHistory") ]
                    in
                    Expect.all
                        [ \_ -> find on |> Query.has [ Selector.attribute (Html.Attributes.attribute "aria-checked" "true") ]
                        , \_ -> find off |> Query.has [ Selector.attribute (Html.Attributes.attribute "aria-checked" "false") ]
                        , \_ -> find on |> Event.simulate Event.click |> Event.expect (GapAccountMsg (GapAccount.LocalHistorySet False))
                        , \_ -> find off |> Event.simulate Event.click |> Event.expect (GapAccountMsg (GapAccount.LocalHistorySet True))
                        ]
                        ()
            , test "Clear asks before it erases: trigger first, confirm group after" <|
                \_ ->
                    let
                        asking =
                            many (View.GapAccount.historyCards (withGap (\g -> { g | clearConfirm = True }) account))

                        idle =
                            many (View.GapAccount.historyCards account)
                    in
                    Expect.all
                        [ \_ -> idle |> Query.has [ Selector.attribute (Html.Attributes.attribute "data-testid" "pref-clear-history-trigger") ]
                        , \_ -> idle |> Query.findAll [ Selector.attribute (Html.Attributes.attribute "data-testid" "pref-clear-history-confirm") ] |> Query.count (Expect.equal 0)
                        , \_ -> asking |> Query.has [ Selector.attribute (Html.Attributes.attribute "data-testid" "pref-clear-history-confirm") ]
                        , \_ ->
                            asking
                                |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "pref-clear-history-confirm") ]
                                |> Event.simulate Event.click
                                |> Event.expect (GapAccountMsg GapAccount.HistoryClearConfirm)
                        ]
                        ()
            , test "a failed erase is an alert with a retry; a running one disables the controls" <|
                \_ ->
                    let
                        failed =
                            many (View.GapAccount.historyCards (withGap (\g -> { g | erase = GapAccount.EraseFailed, historyStatus = Just "Couldn't clear all local history." }) account))

                        running =
                            many (View.GapAccount.historyCards (withGap (\g -> { g | erase = GapAccount.Erasing }) account))
                    in
                    Expect.all
                        [ \_ -> failed |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "pref-history-status") ] |> Query.has [ Selector.attribute (Html.Attributes.attribute "role" "alert") ]
                        , \_ -> failed |> Query.has [ Selector.text "Try erasing again" ]
                        , \_ -> running |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "pref-clear-history-trigger") ] |> Query.has [ Selector.disabled True ]
                        , \_ -> running |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "pref-toggle-localHistory") ] |> Query.has [ Selector.disabled True ]
                        ]
                        ()
            , test "saved searches: the clear button is disabled with none, counts read correctly" <|
                \_ ->
                    let
                        none =
                            many (View.GapAccount.historyCards account)
                    in
                    Expect.all
                        [ \_ -> none |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "pref-saved-searches-clear") ] |> Query.has [ Selector.disabled True ]
                        , \_ -> none |> Query.has [ Selector.text "0 saved searches" ]
                        ]
                        ()
            ]
        , describe "Import & export"
            [ test "Export asks for a review first, then downloads" <|
                \_ ->
                    let
                        idle =
                            one (View.GapAccount.exportButton "hi-btn" account)

                        reviewing =
                            withGap (\g -> { g | exportConfirm = True }) account
                    in
                    Expect.all
                        [ \_ -> idle |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "pref-vault-export") ] |> Event.simulate Event.click |> Event.expect (GapAccountMsg GapAccount.ExportAsk)
                        , \_ -> one (View.GapAccount.exportButton "hi-btn" reviewing) |> Query.has [ Selector.disabled True ]
                        , \_ -> one (View.GapAccount.exportReview reviewing) |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "pref-export-confirm") ] |> Event.simulate Event.click |> Event.expect (GapAccountMsg GapAccount.ExportConfirm)
                        , \_ -> one (View.GapAccount.exportReview reviewing) |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "pref-export-review") ] |> Query.has [ Selector.attribute (Html.Attributes.attribute "role" "group") ]
                        ]
                        ()
            , test "the portable-vault card's Export button is ours (asks for a review) and the review sits under it" <|
                \_ ->
                    let
                        reviewing =
                            withGap (\g -> { g | exportConfirm = True }) account
                    in
                    Expect.all
                        [ \_ -> one (View.GapAccount.exportButton "hi-btn" account) |> Query.has [ Selector.text "Export vault" ]
                        , \_ -> one (View.GapAccount.exportReview account) |> Query.hasNot [ Selector.attribute (Html.Attributes.attribute "data-testid" "pref-export-review") ]
                        , \_ -> one (View.GapAccount.exportReview reviewing) |> Query.has [ Selector.text "Before you download" ]
                        ]
                        ()
            , test "saved searches have export and import buttons" <|
                \_ ->
                    let
                        v =
                            many (View.GapAccount.transferCards account)
                    in
                    Expect.all
                        [ \_ -> v |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "pref-saved-searches-export") ] |> Event.simulate Event.click |> Event.expect (GapAccountMsg GapAccount.SearchExport)
                        , \_ -> v |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "pref-saved-searches-import") ] |> Event.simulate Event.click |> Event.expect (GapAccountMsg GapAccount.SearchImport)
                        ]
                        ()
            ]
        ]

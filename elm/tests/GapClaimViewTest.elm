module GapClaimViewTest exposing (suite)

{-| v3/gap-claim — what the Home card and the Preferences card say and
offer, and which message each control sends. The state machine is in
`GapClaimTest`; the wiring is in `GapClaimAppTest`.
-}

import App exposing (..)
import Credentials
import Expect
import GapClaim
import Html
import Html.Attributes
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View.GapClaim


kaiKey : String
kaiKey =
    "[\"onyx\",\"account\",\"kai\"]"


summary : GapClaim.Summary
summary =
    { rows = 1284
    , conversations = 17
    , oldest = Just 1772528400000
    , newest = Just 1791493200000
    , undated = 0
    , otherOwners = 0
    , truncated = False
    }


{-| A signed-in account with a found prompt. -}
asKai : Model
asKai =
    let
        ga =
            blank.gapAccount
    in
    { blank
        | gapAccount = { ga | scope = Just kaiKey, scopeGuest = False, socketAccount = Just "kai" }
        , gapClaim = { scope = Just kaiKey, scan = GapClaim.Found summary, phase = GapClaim.Resting, dismissed = False, interrupted = False, guest = "" }
    }


asGuest : Model
asGuest =
    let
        ga =
            blank.gapAccount
    in
    { asKai | gapAccount = { ga | scope = Just "[\"onyx\",\"guest\"]", scopeGuest = True, socketAccount = Nothing } }


withClaim : (GapClaim.State -> GapClaim.State) -> Model -> Model
withClaim f model =
    { model | gapClaim = f model.gapClaim }


home : Model -> Query.Single Msg
home model =
    Query.fromHtml (Html.div [] [ View.GapClaim.homeCard model ])


prefs : Model -> Query.Single Msg
prefs model =
    Query.fromHtml (Html.div [] [ View.GapClaim.prefsCard model ])


testId : String -> Selector.Selector
testId id =
    Selector.attribute (Html.Attributes.attribute "data-testid" id)


has : String -> Query.Single Msg -> Expect.Expectation
has text =
    Query.has [ Selector.text text ]


hasNot : String -> Query.Single Msg -> Expect.Expectation
hasNot text =
    Query.hasNot [ Selector.text text ]


finished : Bool -> String -> GapClaim.Op -> GapClaim.Phase
finished ok reason op =
    GapClaim.Finished { op = op, ok = ok, reason = reason, total = 1284, moved = 400, merged = 0, remaining = 884 }


suite : Test
suite =
    describe "v3/gap-claim views"
        [ describe "Home card"
            [ test "asks the one-time question for the signed-in account, with counts and dates but no message text" <|
                \_ ->
                    Expect.all
                        [ has "History from before this update is stored on this device."
                        , has "1,284 messages in 17 conversations"
                        , has "Mar 3, 2026 \u{2013} Oct 8, 2026"
                        , has "Attach it to kai?"
                        , has "Only kai will be able to see, search or export it."
                        , Query.has [ testId "claim-attach" ]
                        , Query.has [ testId "claim-not-now" ]
                        , Query.has [ testId "claim-delete" ]
                        ]
                        (home asKai)
            , test "a guest is told guest history is shared by guests on this network, and to sign in first" <|
                \_ ->
                    Expect.all
                        [ has "Attach it to guest history?"
                        , has "shared by every guest session on this network"
                        , has "Sign in first"
                        , Query.has [ Selector.text "Attach to guest history" ]
                        ]
                        (home asGuest)
            , test "more than one identity on the device is spelled out" <|
                \_ ->
                    Expect.all
                        [ has "Other accounts and guests that use this device won\u{2019}t see it."
                        ]
                        (home (withClaim (\c -> { c | scan = GapClaim.Found { summary | otherOwners = 1 } }) asKai))
            , test "a remembered sign-in for someone else counts as another identity" <|
                \_ ->
                    let
                        remembered =
                            asKai.rememberedIds

                        other =
                            { id = "saved-1-1", nick = "lee", server = "onyx", savedAt = "", active = False, access = Credentials.IdentityOnlyAccess }

                        model =
                            { asKai | rememberedIds = { remembered | identities = [ other ] } }
                    in
                    has "Other accounts and guests that use this device won\u{2019}t see it." (home model)
            , test "is absent when nothing is waiting, after Not now, and while still scanning" <|
                \_ ->
                    Expect.all
                        [ \_ -> Query.hasNot [ testId "home-claim" ] (home (withClaim (\c -> { c | scan = GapClaim.Clear }) asKai))
                        , \_ -> Query.hasNot [ testId "home-claim" ] (home (withClaim (\c -> { c | dismissed = True }) asKai))
                        , \_ -> Query.hasNot [ testId "home-claim" ] (home (withClaim (\c -> { c | scan = GapClaim.Scanning }) asKai))
                        ]
                        ()
            , test "an interrupted attach asks to finish" <|
                \_ ->
                    Expect.all
                        [ has "Attaching your earlier history was interrupted."
                        , has "Finish attaching it to kai?"
                        , has "Finish attaching to kai"
                        ]
                        (home (withClaim (\c -> { c | interrupted = True }) asKai))
            , test "each control sends its message" <|
                \_ ->
                    Expect.all
                        [ \_ -> home asKai |> Query.find [ testId "claim-attach" ] |> Event.simulate Event.click |> Event.expect (GapClaimMsg GapClaim.AttachClicked)
                        , \_ -> home asKai |> Query.find [ testId "claim-not-now" ] |> Event.simulate Event.click |> Event.expect (GapClaimMsg GapClaim.NotNowClicked)
                        , \_ -> home asKai |> Query.find [ testId "claim-delete" ] |> Event.simulate Event.click |> Event.expect (GapClaimMsg GapClaim.DeleteAsked)
                        ]
                        ()
            , test "Attach is disabled, with the reason, while local history is off" <|
                \_ ->
                    let
                        prefsRecord =
                            asKai.prefs

                        off =
                            { asKai | prefs = { prefsRecord | localHistory = False } }
                    in
                    Expect.all
                        [ Query.find [ testId "claim-attach" ] >> Query.has [ Selector.disabled True ]
                        , Query.has [ testId "claim-blocked" ]
                        , Query.find [ testId "claim-delete" ] >> Query.hasNot [ Selector.disabled True ]
                        ]
                        (home off)
            ]
        , describe "delete confirm"
            [ test "replaces the actions with a confirm that names the count and cannot be undone" <|
                \_ ->
                    let
                        model =
                            withClaim (\c -> { c | phase = GapClaim.ConfirmingDelete }) asKai
                    in
                    Expect.all
                        [ has "Delete 1,284 messages from before this update? This can\u{2019}t be undone."
                        , Query.has [ testId "claim-delete-confirm" ]
                        , Query.has [ testId "claim-delete-keep" ]
                        , Query.hasNot [ testId "claim-attach" ]
                        , \q -> q |> Query.find [ testId "claim-delete-confirm" ] |> Event.simulate Event.click |> Event.expect (GapClaimMsg GapClaim.DeleteConfirmed)
                        , \q -> q |> Query.find [ testId "claim-delete-keep" ] |> Event.simulate Event.click |> Event.expect (GapClaimMsg GapClaim.DeleteCancelled)
                        ]
                        (home model)
            ]
        , describe "progress and results"
            [ test "an attach in flight shows a progress bar and no controls" <|
                \_ ->
                    let
                        model =
                            withClaim (\c -> { c | phase = GapClaim.Working GapClaim.Attach { done = 600, total = 1284 } }) asKai
                    in
                    Expect.all
                        [ has "Attaching\u{2026}"
                        , Query.find [ testId "claim-progress" ] >> Query.has [ Selector.attribute (Html.Attributes.attribute "aria-valuenow" "47"), Selector.attribute (Html.Attributes.attribute "role" "progressbar") ]
                        , Query.hasNot [ testId "claim-attach" ]
                        , Query.hasNot [ testId "claim-delete" ]
                        , Query.has [ Selector.attribute (Html.Attributes.attribute "aria-busy" "true") ]
                        ]
                        (home model)
            , test "a verified attach says exactly what was attached and offers Done" <|
                \_ ->
                    let
                        model =
                            withClaim
                                (\c ->
                                    { c
                                        | scan = GapClaim.Clear
                                        , phase = GapClaim.Finished { op = GapClaim.Attach, ok = True, reason = "", total = 1284, moved = 1284, merged = 0, remaining = 0 }
                                    }
                                )
                                asKai
                    in
                    Expect.all
                        [ has "Attached 1,284 messages to kai."
                        , Query.has [ testId "claim-done" ]
                        , Query.hasNot [ testId "claim-retry" ]
                        , \q -> q |> Query.find [ testId "claim-done" ] |> Event.simulate Event.click |> Event.expect (GapClaimMsg GapClaim.Acknowledged)
                        ]
                        (home model)
            , test "a failed attach is an alert with a retry, and says nothing was lost" <|
                \_ ->
                    let
                        model =
                            withClaim (\c -> { c | phase = finished False "write" GapClaim.Attach }) asKai
                    in
                    Expect.all
                        [ has "400 of 1,284 attached. The rest is still stored safely on this device"
                        , Query.find [ testId "claim-result" ] >> Query.has [ Selector.attribute (Html.Attributes.attribute "role" "alert") ]
                        , Query.has [ testId "claim-retry" ]
                        , \q -> q |> Query.find [ testId "claim-retry" ] |> Event.simulate Event.click |> Event.expect (GapClaimMsg GapClaim.AttachClicked)
                        ]
                        (home model)
            , test "a failed delete retries through the confirm" <|
                \_ ->
                    let
                        model =
                            withClaim (\c -> { c | phase = finished False "write" GapClaim.Delete }) asKai
                    in
                    home model
                        |> Query.find [ testId "claim-retry" ]
                        |> Event.simulate Event.click
                        |> Event.expect (GapClaimMsg GapClaim.DeleteAsked)
            , test "a history-off refusal has no pointless retry" <|
                \_ ->
                    let
                        model =
                            withClaim (\c -> { c | phase = finished False "history-off" GapClaim.Attach }) asKai
                    in
                    Expect.all
                        [ has "Local history is off"
                        , Query.hasNot [ testId "claim-retry" ]
                        , Query.has [ testId "claim-done" ]
                        ]
                        (home model)
            , test "the result of a decision made from Preferences does not pop the Home card back after Not now" <|
                \_ ->
                    let
                        model =
                            withClaim (\c -> { c | dismissed = True, phase = finished True "" GapClaim.Attach }) asKai
                    in
                    Query.hasNot [ testId "home-claim" ] (home model)
            ]
        , describe "Preferences card"
            [ test "stays after Not now, offers Attach and Delete but no Not now, and counts the messages" <|
                \_ ->
                    let
                        model =
                            withClaim (\c -> { c | dismissed = True }) asKai
                    in
                    Expect.all
                        [ Query.has [ testId "pref-claim" ]
                        , has "1,284 messages"
                        , has "Attach it to kai?"
                        , Query.has [ testId "claim-attach" ]
                        , Query.has [ testId "claim-delete" ]
                        , Query.hasNot [ testId "claim-not-now" ]
                        ]
                        (prefs model)
            , test "is absent when nothing is waiting" <|
                \_ ->
                    Query.hasNot [ testId "pref-claim" ] (prefs (withClaim (\c -> { c | scan = GapClaim.Clear }) asKai))
            ]
        ]

module RxSheetsTest exposing (suite)

{-| Vectors for the v3/rx-sheets slice: every overlay has one close
affordance and one Escape owner; destructive room blocks review before
they send; one sheet at a time over the You hub (the reclaim dialog is
reachable from the hub where the identity chip is hidden); the member
card is a named modal dialog in the shared focus scope.
-}

import App exposing (..)
import Expect
import Html
import Html.Attributes as Attr
import Polish
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View


feed : Model -> String -> Model
feed model line =
    Tuple.first (update (WsLineReceived line) model)


step : Msg -> Model -> Model
step msg model =
    Tuple.first (update msg model)


inRoom : Model
inRoom =
    { blank | caps = [], connection = Live }
        |> (\m -> feed m ":me!u@h JOIN #c")
        |> step (ChannelSelect "#c")


opped : Model
opped =
    feed inRoom ":op!u@h MODE #c +o me"


query : Model -> Query.Single Msg
query model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


testid : String -> Selector.Selector
testid id =
    Selector.attribute (Attr.attribute "data-testid" id)


suite : Test
suite =
    describe "v3/rx-sheets"
        [ banReviewSuite
        , youHubSuite
        , memberCardSuite
        ]


banReviewSuite : Test
banReviewSuite =
    let
        base =
            blankBanAdd

        filled =
            { opped | banAdd = { base | mask = "*!*@spam.example", minutes = "15" }, moderationOpen = True }
    in
    describe "a timed block is reviewed before it sends"
        [ test "Review block stages the confirm and sends nothing" <|
            \_ ->
                let
                    ( m, outs ) =
                        update (BanAddReview "#c") filled
                in
                Expect.all
                    [ \_ -> Expect.equal True m.banAdd.reviewing
                    , \_ -> Expect.equal [] outs
                    , \_ -> Expect.equal "" m.banAdd.error
                    ]
                    ()
        , test "an invalid form reports instead of staging" <|
            \_ ->
                let
                    ( m, outs ) =
                        update (BanAddReview "#c") { filled | banAdd = { base | mask = "  ", minutes = "15" } }
                in
                Expect.all
                    [ \_ -> Expect.equal False m.banAdd.reviewing
                    , \_ -> Expect.equal [] outs
                    , \_ -> Expect.equal "Enter a ban mask." m.banAdd.error
                    ]
                    ()
        , test "editing a field re-arms the review; Cancel stands it down" <|
            \_ ->
                let
                    staged =
                        step (BanAddReview "#c") filled
                in
                Expect.all
                    [ \_ -> Expect.equal False (step (BanAddMinutes "30") staged).banAdd.reviewing
                    , \_ -> Expect.equal False (step BanAddReviewCancel staged).banAdd.reviewing
                    , \_ -> Expect.equal "*!*@spam.example" (step BanAddReviewCancel staged).banAdd.mask
                    ]
                    ()
        , test "the desk shows Review first, the solid Add block only in the confirm" <|
            \_ ->
                let
                    staged =
                        step (BanAddReview "#c") filled
                in
                Expect.all
                    [ \_ -> query filled |> Query.has [ testid "ban-add-review-open" ]
                    , \_ -> query filled |> Query.hasNot [ testid "ban-add-submit" ]
                    , \_ ->
                        query staged
                            |> Query.find [ testid "ban-add-review" ]
                            |> Query.has [ Selector.text "Block *!*@spam.example in #c for 15 minutes? It lifts on its own when the time is up." ]
                    , \_ ->
                        query staged
                            |> Query.find [ testid "ban-add-submit" ]
                            |> Event.simulate Event.click
                            |> Event.expect (BanAddSubmit "#c")
                    , \_ ->
                        query staged
                            |> Query.find [ testid "ban-add-cancel" ]
                            |> Event.simulate Event.click
                            |> Event.expect BanAddReviewCancel
                    ]
                    ()
        , test "the confirmed block sends +b and clears the review" <|
            \_ ->
                let
                    ( m, outs ) =
                        update (BanAddSubmit "#c") (step (BanAddReview "#c") filled)
                in
                Expect.all
                    [ \_ -> Expect.equal True (List.member (SendLine "MODE #c +b *!*@spam.example\u{000D}\n") outs)
                    , \_ -> Expect.equal False m.banAdd.reviewing
                    ]
                    ()
        ]


youHubSuite : Test
youHubSuite =
    let
        parked =
            { inRoom | currentNickIsAlias = True, accountName = Just "alice", ourNick = "alice_", youHubOpen = True }
    in
    describe "the You hub"
        [ test "its head is the shared pinned head: title and the one close" <|
            \_ ->
                let
                    hub =
                        query { inRoom | youHubOpen = True } |> Query.find [ testid "you-hub" ]
                in
                Expect.all
                    [ \_ -> hub |> Query.has [ Selector.attribute (Attr.attribute "aria-labelledby" "onyx-sheet-you-title") ]
                    , \_ -> hub |> Query.find [ Selector.id "onyx-sheet-you-title" ] |> Query.has [ Selector.text "You" ]
                    , \_ ->
                        hub
                            |> Query.find [ testid "you-close" ]
                            |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Close You") ]
                    ]
                    ()
        , test "offers to take a parked name back, and that closes the hub" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        query parked
                            |> Query.find [ testid "you-reclaim" ]
                            |> Event.simulate Event.click
                            |> Event.expect ReclaimOpen
                    , \_ -> query { inRoom | youHubOpen = True } |> Query.hasNot [ testid "you-reclaim" ]
                    , \_ ->
                        let
                            m =
                                step ReclaimOpen parked
                        in
                        Expect.equal ( True, False ) ( m.reclaimOpen, m.youHubOpen )
                    ]
                    ()
        , test "any sheet opening over it closes it; the quiet asks do not" <|
            \_ ->
                let
                    hub =
                        { inRoom | youHubOpen = True }
                in
                Expect.all
                    [ \_ -> Expect.equal False (step NewMessageOpen hub).youHubOpen
                    , \_ -> Expect.equal False (step ShortcutsOpen hub).youHubOpen
                    , \_ -> Expect.equal True (step (PolishMsg Polish.NotifyDismiss) hub).youHubOpen
                    ]
                    ()
        ]


memberCardSuite : Test
memberCardSuite =
    let
        carded =
            step (UserProfileOpened { nick = "op", channel = "#c" }) opped
    in
    describe "the member card"
        [ test "is a named modal dialog in the overlay focus scope with a close" <|
            \_ ->
                let
                    card =
                        query carded |> Query.find [ Selector.class "onyx-member-card" ]
                in
                Expect.all
                    [ \_ ->
                        card
                            |> Query.has
                                [ Selector.attribute (Attr.attribute "role" "dialog")
                                , Selector.attribute (Attr.attribute "aria-modal" "true")
                                , Selector.attribute (Attr.attribute "data-shortcut-scope" "member-card")
                                ]
                    , \_ ->
                        card
                            |> Query.find [ testid "member-card-close" ]
                            |> Event.simulate Event.click
                            |> Event.expect UserProfileClosed
                    , \_ -> Expect.equal (Just UserProfileClosed) (escapeMsg carded)
                    ]
                    ()
        ]

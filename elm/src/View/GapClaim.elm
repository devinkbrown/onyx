module View.GapClaim exposing (homeCard, prefsCard)

{-| v3/gap-claim views — the calm, dismissible prompt about history
from before this update (rows with no owner stamp).

  - `homeCard` — the one-time prompt on Home: "History from before this
    update is stored on this device. Attach it to <identity>?" with
    Attach / Not now / Delete it. "Not now" hides it for good on this
    device.
  - `prefsCard` — the same decision as a row under Preferences → History
    & data, there for as long as the rows exist (no "Not now": nothing
    to dismiss).

The scan only ever knew counts and dates, so that is all these show -
never message text. State and rules: `GapClaim`; folds: `App`
(`updateGapClaim`).

-}

import App exposing (Model, Msg(..))
import GapClaim exposing (Op(..), Phase(..), Scan(..))
import HistoryImport
import Html exposing (Html, button, div, h2, h3, p, section, span, text)
import Html.Attributes exposing (attribute, class, classList, disabled, id, style, tabindex, type_)
import Html.Events exposing (onClick)


type Place
    = Home
    | Prefs


claim : GapClaim.Msg -> Msg
claim =
    GapClaimMsg


homeCard : Model -> Html Msg
homeCard model =
    if GapClaim.homeVisible model.gapClaim then
        card Home model

    else
        text ""


prefsCard : Model -> Html Msg
prefsCard model =
    if GapClaim.prefsVisible model.gapClaim then
        card Prefs model

    else
        text ""


placeKey : Place -> String
placeKey place =
    case place of
        Home ->
            "home"

        Prefs ->
            "prefs"


{-| The account the history would be attached to; `Nothing` = the guest
scope. -}
accountOf : Model -> Maybe String
accountOf model =
    if model.gapAccount.scopeGuest then
        Nothing

    else
        Just (Maybe.withDefault "this account" model.gapAccount.socketAccount)


card : Place -> Model -> Html Msg
card place model =
    let
        st =
            model.gapClaim

        key =
            placeKey place

        titleId =
            GapClaim.elementId key "title"

        summary =
            case st.scan of
                Found s ->
                    Just s

                _ ->
                    Nothing

        heading =
            case place of
                Home ->
                    h2 [ class "gc-kicker", id titleId ] [ text "Earlier history" ]

                Prefs ->
                    div [ class "pref-group-head" ]
                        [ h3 [ class "pref-label", id titleId ] [ text "Earlier history" ]
                        , case summary of
                            Just s ->
                                span [ class "pref-count" ] [ text (HistoryImport.countLabel s.rows "message") ]

                            Nothing ->
                                text ""
                        ]
    in
    section
        [ class "gc-card"
        , classList [ ( "gc-card--home", place == Home ), ( "gc-card--prefs pref-group", place == Prefs ) ]
        , attribute "aria-labelledby" titleId
        , attribute "aria-busy"
            (if GapClaim.busy st then
                "true"

             else
                "false"
            )
        , attribute "data-testid"
            (case place of
                Home ->
                    "home-claim"

                Prefs ->
                    "pref-claim"
            )
        ]
        (heading :: bodyFor place model summary)


bodyFor : Place -> Model -> Maybe GapClaim.Summary -> List (Html Msg)
bodyFor place model summary =
    let
        st =
            model.gapClaim

        key =
            placeKey place

        account =
            accountOf model
    in
    case st.phase of
        Working op progress ->
            working key op progress

        Finished outcome ->
            finished key account outcome

        ConfirmingDelete ->
            case summary of
                Just s ->
                    prompt place model s True

                Nothing ->
                    []

        Resting ->
            case summary of
                Just s ->
                    prompt place model s False

                Nothing ->
                    []


prompt : Place -> Model -> GapClaim.Summary -> Bool -> List (Html Msg)
prompt place model summary confirming =
    let
        st =
            model.gapClaim

        key =
            placeKey place

        account =
            accountOf model

        shared =
            GapClaim.sharedDevice
                { otherOwners = summary.otherOwners
                , remembered = List.map .nick model.rememberedIds.identities
                , account = account
                }

        blocker =
            GapClaim.attachBlocker model.prefs.localHistory

        lead =
            if st.interrupted then
                "Attaching your earlier history was interrupted. What\u{2019}s left is still stored on this device."

            else
                "History from before this update is stored on this device."
    in
    [ p [ class "gc-lead" ] [ text lead ]
    , p [ class "gc-facts", attribute "data-testid" "claim-facts" ]
        [ span [ class "gc-facts-counts" ] [ text (GapClaim.countsLine summary) ]
        , span [ class "gc-facts-range" ] [ text (GapClaim.rangeLabel model.zone summary) ]
        ]
    , p [ class "gc-ask" ] [ text (GapClaim.question st.interrupted account) ]
    , div [ class "gc-notes" ]
        (List.map (\line -> p [ class "gc-note" ] [ text line ]) (GapClaim.explainLines { account = account, shared = shared })
            ++ (case blocker of
                    Just why ->
                        [ p [ class "gc-note gc-note--warn", attribute "data-testid" "claim-blocked" ] [ text why ] ]

                    Nothing ->
                        []
               )
        )
    , if confirming then
        confirmDelete key summary

      else
        div [ class "gc-actions" ]
            [ button
                [ type_ "button"
                , class "gc-btn gc-btn--primary"
                , disabled (blocker /= Nothing)
                , attribute "data-testid" "claim-attach"
                , onClick (claim GapClaim.AttachClicked)
                ]
                [ text (GapClaim.attachLabel st.interrupted account) ]
            , if place == Home then
                button
                    [ type_ "button"
                    , class "gc-btn"
                    , attribute "data-testid" "claim-not-now"
                    , onClick (claim GapClaim.NotNowClicked)
                    ]
                    [ text "Not now" ]

              else
                text ""
            , button
                [ type_ "button"
                , id (GapClaim.elementId key "delete")
                , class "gc-btn gc-btn--quiet"
                , attribute "aria-label" "Delete the history from before this update"
                , attribute "data-testid" "claim-delete"
                , onClick (claim GapClaim.DeleteAsked)
                ]
                [ text "Delete it\u{2026}" ]
            ]
    ]


confirmDelete : String -> GapClaim.Summary -> Html Msg
confirmDelete key summary =
    div [ class "gc-confirm", attribute "role" "group", attribute "aria-label" "Confirm delete", attribute "data-testid" "claim-confirm" ]
        [ p [ class "gc-note gc-note--strong" ]
            [ text
                ("Delete "
                    ++ HistoryImport.countLabel summary.rows "message"
                    ++ " from before this update? This can\u{2019}t be undone."
                )
            ]
        , div [ class "gc-actions" ]
            [ button
                [ type_ "button"
                , class "gc-btn gc-btn--danger"
                , attribute "data-testid" "claim-delete-confirm"
                , onClick (claim GapClaim.DeleteConfirmed)
                ]
                [ text "Delete it" ]
            , button
                [ type_ "button"
                , id (GapClaim.elementId key "keep")
                , class "gc-btn"
                , attribute "data-testid" "claim-delete-keep"
                , onClick (claim GapClaim.DeleteCancelled)
                ]
                [ text "Keep it" ]
            ]
        ]


working : String -> Op -> { done : Int, total : Int } -> List (Html Msg)
working key op progress =
    let
        pct =
            GapClaim.progressPercent progress

        verb =
            case op of
                Attach ->
                    "Attaching\u{2026}"

                Delete ->
                    "Deleting\u{2026}"
    in
    [ p
        [ class "gc-lead"
        , id (GapClaim.elementId key "status")
        , tabindex -1
        , attribute "role" "status"
        , attribute "data-testid" "claim-status"
        ]
        [ text verb ]
    , div
        [ class "gc-bar"
        , attribute "role" "progressbar"
        , attribute "aria-label"
            (case op of
                Attach ->
                    "Attach progress"

                Delete ->
                    "Delete progress"
            )
        , attribute "aria-valuemin" "0"
        , attribute "aria-valuemax" "100"
        , attribute "aria-valuenow" (String.fromInt pct)
        , attribute "data-testid" "claim-progress"
        ]
        [ span [ class "gc-bar-fill", style "width" (String.fromInt pct ++ "%") ] [] ]
    , p [ class "gc-facts", attribute "aria-hidden" "true" ]
        [ text (HistoryImport.groupThousands progress.done ++ " of " ++ HistoryImport.groupThousands progress.total) ]
    , p [ class "gc-note" ] [ text "You can keep using Onyx meanwhile. Nothing leaves this device." ]
    ]


finished : String -> Maybe String -> GapClaim.Outcome -> List (Html Msg)
finished key account outcome =
    [ p
        [ class "gc-lead"
        , classList [ ( "gc-lead--bad", not outcome.ok ) ]
        , id (GapClaim.elementId key "status")
        , tabindex -1
        , attribute "role"
            (if outcome.ok then
                "status"

             else
                "alert"
            )
        , attribute "data-testid" "claim-result"
        ]
        [ text (GapClaim.outcomeText account outcome) ]
    , div [ class "gc-actions" ]
        (if outcome.ok then
            [ button
                [ type_ "button"
                , class "gc-btn"
                , attribute "data-testid" "claim-done"
                , onClick (claim GapClaim.Acknowledged)
                ]
                [ text "Done" ]
            ]

         else
            [ if outcome.reason == "history-off" then
                text ""

              else
                button
                    [ type_ "button"
                    , class "gc-btn gc-btn--primary"
                    , attribute "data-testid" "claim-retry"
                    , onClick
                        (claim
                            (case outcome.op of
                                Attach ->
                                    GapClaim.AttachClicked

                                Delete ->
                                    GapClaim.DeleteAsked
                            )
                        )
                    ]
                    [ text "Try again" ]
            , button
                [ type_ "button"
                , class "gc-btn"
                , attribute "data-testid" "claim-done"
                , onClick (claim GapClaim.Acknowledged)
                ]
                [ text "Close" ]
            ]
        )
    ]

module View.Guides exposing (GuideHowto, guideHowtos, route, view)

{-| Getting-started guides, mirroring `src/routes/Guides.tsx`
(surfaces `/guides` + `/community`): hero, task index, the first-room
plan (progress, route map, safety snapshot, local share, reset), the
principles card, and the how-to cards with done toggles.

Fold ownership: plan progress, persistence, and the share round-trip
live in `App` (`guidesCompleted`, `GuidesToggleStep`,
`GuidesCopyPlan`, `guidesPlanExport`); the copy reuses the
`ClipboardCopy` port. Step titles stay single-sourced in `Guides`.
Document metadata beyond the title stays ports-side.
-}

import App exposing (GuidesShare(..), Model, Msg(..), guidesPlanExport)
import Guides exposing (Surface(..), guideStepIds, guideStepTitles, progressSummary, requiredSteps, safetyNotes)
import Html exposing (Html, a, article, aside, button, div, h1, h2, h3, li, nav, ol, p, progress, section, span, text, ul)
import Html.Attributes exposing (attribute, class, download, href, id, rel, target, value)
import Html.Attributes as Attr
import Html.Events exposing (onClick)
import Url
import View.PublicFrame exposing (frame)


{-| One how-to card. -}
type alias GuideHowto =
    { id : String
    , title : String
    , optional : Bool
    , body : List String
    , links : List { href : String, label : String }
    }


{-| The how-tos, mirroring `GUIDE_HOWTOS` (`CALL_RECORDING_NOTE` is
the shared `Guides.callRecordingNote` wording). -}
guideHowtos : List GuideHowto
guideHowtos =
    [ { id = "join"
      , title = "Join a room"
      , optional = False
      , body =
            [ "Open Onyx in your browser. Pick a name — guests are welcome, and an account is optional."
            , "Browse rooms, or open a room someone invited you to. Say hello."
            ]
      , links =
            [ { href = "/app/", label = "Join a room" }
            , { href = "/app/?join=%23root", label = "Open the public room" }
            ]
      }
    , { id = "invite"
      , title = "Invite a friend"
      , optional = False
      , body =
            [ "Send them to Onyx, or share an invite if you have one. They can join as a guest and pick a name."
            , "Tell them the room you are in. Friends, clubs, and class groups all start the same way: one person opens the door."
            ]
      , links = [ { href = "/invite/", label = "Open an invite" } ]
      }
    , { id = "messages"
      , title = "Messages and private DMs"
      , optional = False
      , body =
            [ "Rooms are shared conversations. Everyone in the room can read them."
            , "Direct messages are one-to-one. Those can be private: Onyx seals them on your device so the rest of the room does not see the words. If a private message cannot open, it stays locked instead of turning into plain text."
            , "Group rooms are not end-to-end encrypted. Passkeys are not the everyday way to sign in."
            ]
      , links = []
      }
    , { id = "calls"
      , title = "Calls when you want them"
      , optional = False
      , body =
            [ "In a room, start a call when you want one — voice, video, or your screen. Joining is a choice; a call does not pull you in."
            , "Calls are opt-in. Onyx does not automatically record calls. Participants can choose local recording of their own audio when supported."
            , "You can see whether the call is protected while you are in it."
            ]
      , links = []
      }
    , { id = "this-device"
      , title = "Keep it on this device"
      , optional = False
      , body =
            [ "Add Onyx to your Home Screen so it sits with your other apps. On a phone, use the browser menu or Share, then Add to Home Screen. On a computer, use the browser menu and Install app when your browser offers it."
            , "Your history and sign-in stay on this device. Coming back in the same browser usually picks up where you left off."
            ]
      , links = [ { href = "/download/", label = "Other ways to keep Onyx" } ]
      }
    , { id = "another-client"
      , title = "Another client, or your own server"
      , optional = True
      , body =
            [ "The official Onyx app in the browser is the usual way in."
            , "Other ways in are available for people who need them, but the official Onyx app in the browser is the usual way to join."
            , "Running your own copy of the engine is for people who want to operate a server."
            ]
      , links =
            [ { href = "https://github.com/devinkbrown/onyx-server", label = "Onyx Server on GitHub" }
            , { href = "/about/", label = "How Onyx is put together" }
            ]
      }
    ]


contextLine : Surface -> Html Msg
contextLine surface =
    let
        kicker =
            case surface of
                GuidesPage ->
                    "Guides"

                CommunityPage ->
                    "Community"
    in
    p [ class "public-frame__current-line" ]
        [ span [ class "public-frame__current-kicker" ] [ text kicker ]
        , span [ attribute "aria-hidden" "true" ] [ text "·" ]
        , span [ class "public-frame__current-label" ] [ text "Getting started" ]
        ]


howtoLink : { href : String, label : String } -> Html Msg
howtoLink link =
    let
        external =
            String.startsWith "http" link.href
    in
    a
        ([ class "guides-action", href link.href ]
            ++ (if external then
                    [ rel "noreferrer noopener", target "_blank" ]

                else
                    []
               )
        )
        [ text link.label ]


howtoCard : List String -> GuideHowto -> Html Msg
howtoCard completed howto =
    let
        done =
            List.member howto.id completed
    in
    article
        [ class
            ("guides-card guides-step"
                ++ (if howto.optional then
                        " guides-card--optional"

                    else if done then
                        " guides-card--complete"

                    else
                        ""
                   )
            )
        , id howto.id
        ]
        ([ div [ class "guides-card__meta" ]
            ([ div [ class "label" ] [ text (if howto.optional then "Optional" else "How-to") ] ]
                ++ (if howto.optional then
                        []

                    else
                        [ button
                            [ class "guides-step-toggle"
                            , Html.Attributes.type_ "button"
                            , attribute "aria-pressed" (if done then "true" else "false")
                            , attribute "aria-label" ("Mark " ++ howto.title ++ (if done then " not complete" else " complete"))
                            , onClick (GuidesToggleStep { id = howto.id })
                            ]
                            [ text (if done then "Done" else "Mark done") ]
                        ]
                   )
            )
         , h2 [] [ text howto.title ]
         ]
            ++ List.map (\paragraph -> p [] [ text paragraph ]) howto.body
            ++ (if List.isEmpty howto.links then
                    []

                else
                    [ p [ class "guides-card-actions" ] (List.map howtoLink howto.links) ]
               )
        )


routeItem : Guides.RoomStarterRouteStep -> Html Msg
routeItem step =
    li [ class "guides-route__item", attribute "data-state" step.state ]
        [ a
            ([ class "guides-route__card", href ("#" ++ step.id) ]
                ++ (if step.state == "current" then
                        [ attribute "aria-current" "step" ]

                    else
                        []
                   )
            )
            [ span [ class "guides-route__copy" ]
                [ span [ class "guides-route__state" ] [ text step.stateLabel ]
                , span [ class "guides-route__title" ] [ text step.title ]
                ]
            ]
        ]


{-| The guides body. -}
view : Surface -> Model -> Html Msg
view surface model =
    let
        key =
            Guides.surfaceKey surface

        kicker =
            Guides.surfaceKicker surface

        summary =
            progressSummary guideStepIds model.guidesCompleted

        starterRoute =
            Guides.buildRoomStarterRoute requiredSteps model.guidesCompleted

        export =
            guidesPlanExport model

        downloadHref =
            "data:text/plain;charset=utf-8," ++ Url.percentEncode export

        shareStatus =
            case model.guidesShare of
                ShareCopying ->
                    Just "Creating your local plan…"

                ShareCopied ->
                    Just "First-room plan copied. It was created here and nothing was sent."

                ShareFailed ->
                    Just "Copy did not complete. Download the text instead; nothing was sent."

                ShareIdle ->
                    Nothing
    in
    div [ class ("ui-root r data-page public-info-page guides-page guides-page--" ++ key) ]
        [ section [ class "r-wrap data-hero guides-hero", attribute "aria-labelledby" "guides-heading" ]
            [ p [ class "guides-kicker" ] [ text kicker ]
            , h1 [ id "guides-heading" ] [ text "Getting started" ]
            , p [ class "sub" ]
                [ text "Friends, clubs, rooms. Open Onyx in your browser, join a room, and talk. These short how-tos are for the official app — not another chat program." ]
            , p [ class "guides-hero-actions" ]
                [ a [ class "guides-action", href "/app/" ] [ text "Join a room" ] ]
            ]
        , section [ class "r-wrap r-section guides-body", attribute "aria-label" "Getting started tasks" ]
            [ aside [ class "guides-index", attribute "aria-labelledby" "guides-index-title" ]
                [ p [ class "guides-index__eyebrow" ] [ text "Start with a task" ]
                , h2 [ id "guides-index-title" ] [ text "Guide tasks" ]
                , nav [ attribute "aria-label" "Guide tasks" ]
                    [ ol [ class "guides-index__list" ]
                        ([ li [] [ a [ class "guides-index__link", href "#together" ] [ text "How we treat each other" ] ] ]
                            ++ List.map
                                (\howto -> li [] [ a [ class "guides-index__link", href ("#" ++ howto.id) ] [ text howto.title ] ])
                                guideHowtos
                        )
                    ]
                ]
            , div [ class "guides-content" ]
                ([ section [ class "guides-progress", attribute "aria-labelledby" "guides-progress-title" ]
                    [ div [ class "guides-progress__head" ]
                        [ div []
                            [ p [ class "guides-progress__eyebrow" ] [ text "Your first room plan" ]
                            , h2 [ id "guides-progress-title" ] [ text "One small step at a time" ]
                            ]
                        , span [ class "guides-progress__count" ]
                            [ text (String.fromInt summary.complete ++ " of " ++ String.fromInt summary.total) ]
                        ]
                    , progress
                        [ class "guides-progress__meter"
                        , attribute "aria-label" "Guide plan progress"
                        , Attr.max (String.fromInt summary.total)
                        , value (String.fromInt summary.complete)
                        , attribute "aria-describedby" "guides-progress-status"
                        ]
                        [ text (String.fromInt summary.complete ++ " of " ++ String.fromInt summary.total) ]
                    , p [ class "guides-progress__status", id "guides-progress-status", attribute "role" "status" ]
                        [ if summary.done then
                            text "You have your bearings. Start a conversation when you are ready."

                          else
                            text ("Your progress stays in this browser. Next: " ++ guideStepTitles (Maybe.withDefault "" summary.nextId) ++ ".")
                        ]
                    , section [ class "guides-route-map", attribute "aria-labelledby" "guides-route-title" ]
                        [ div [ class "guides-route-map__head" ]
                            [ p [ class "guides-route-map__eyebrow" ] [ text "Room starter" ]
                            , h3 [ id "guides-route-title" ] [ text "A route for the first room" ]
                            ]
                        , ol [ class "guides-route", attribute "aria-label" "First room route" ]
                            (List.map routeItem starterRoute)
                        ]
                    , div [ class "guides-starter-details" ]
                        [ section [ class "guides-snapshot", attribute "aria-labelledby" "guides-snapshot-title" ]
                            [ p [ class "guides-snapshot__eyebrow" ] [ text "Before you enter" ]
                            , h3 [ id "guides-snapshot-title" ] [ text "Privacy and safety, at a glance" ]
                            , ul [] (List.map (\note -> li [] [ text note ]) safetyNotes)
                            ]
                        , section [ class "guides-share", attribute "aria-labelledby" "guides-share-title" ]
                            [ p [ class "guides-share__eyebrow" ] [ text "Your handoff slip" ]
                            , h3 [ id "guides-share-title" ] [ text "Share this plan locally" ]
                            , p [] [ text "Copy or download this small text plan. Onyx does not send it anywhere." ]
                            , div [ class "guides-share__actions" ]
                                [ button
                                    [ class "guides-copy"
                                    , Html.Attributes.type_ "button"
                                    , attribute "aria-label" "Copy first-room plan"
                                    , attribute "aria-describedby" "guides-share-status"
                                    , Html.Attributes.disabled (model.guidesShare == ShareCopying)
                                    , onClick GuidesCopyPlan
                                    ]
                                    [ text (if model.guidesShare == ShareCopying then "Copying plan…" else "Copy plan") ]
                                , a [ class "guides-download", href downloadHref, download Guides.roomStarterExportFilename ]
                                    [ text "Download text" ]
                                ]
                            , p
                                [ class "guides-share__status"
                                , id "guides-share-status"
                                , attribute "role" "status"
                                , attribute "aria-live" "polite"
                                , attribute "aria-atomic" "true"
                                , attribute "aria-label" "Plan share status"
                                ]
                                [ text (Maybe.withDefault "" shareStatus) ]
                            ]
                        ]
                    , div [ class "guides-progress__actions" ]
                        ((case summary.nextId of
                                    Just nextId ->
                                        [ a [ class "guides-action", href ("#" ++ nextId) ]
                                            [ text ("Go to: " ++ guideStepTitles nextId) ]
                                        ]

                                    Nothing ->
                                        []
                               )
                            ++ (if summary.complete > 0 then
                                    [ button [ class "guides-reset", Html.Attributes.type_ "button", onClick GuidesResetPlan ]
                                        [ text "Reset plan" ]
                                    ]

                                else
                                    []
                               )
                        )
                    ]
                , article [ class "guides-card guides-card--principles", id "together" ]
                    [ div [ class "label" ] [ text "How we treat each other" ]
                    , h2 [] [ text "Be kind, then talk" ]
                    , p []
                        [ text "Welcome people. Argue about ideas, not people. Do not harass anyone, do not share someone else’s private information, and do not spam. A room can be stricter than that. If a room is not for you, leave." ]
                    ]
                ]
                ++ List.map (howtoCard model.guidesCompleted) guideHowtos
                )
            ]
        ]


{-| The guides route inside the public frame. -}
route : Model -> Surface -> List (Html Msg)
route model surface =
    [ frame model ("/" ++ Guides.surfaceKey surface ++ "/") (Guides.surfaceMainLabel surface) (Just (contextLine surface)) [ view surface model ] ]

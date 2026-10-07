module Guides exposing
    ( RoomStarterStep
    , RoomStarterRouteStep
    , Surface(..)
    , buildRoomStarterExport
    , buildRoomStarterRoute
    , callRecordingNote
    , filterProgressIds
    , legacyCallRecordingNote
    , guideProgressStorageKey
    , guideStepIds
    , guideStepTitles
    , progressSummary
    , requiredSteps
    , roomStarterExportFilename
    , roomStarterSafetyNotes
    , safetyNotes
    , surfaceForRoute
    , surfaceKey
    , surfaceKicker
    , surfaceMainLabel
    , surfaceTitle
    )

{-| Pure first-room plan logic, mirroring `lib/guides/progress.ts` and
`lib/guides/roomStarter.ts`: progress summary over the required
how-to ids, the deterministic starter route (done/current/later),
and the local text handoff (clipboard or download — never sent
anywhere).

Persistence (`onyx:guides-progress-v1` in localStorage) stays
ports-side; this module only decides which ids are allowlisted.
-}

import Route exposing (Route)


{-| localStorage key for guide progress. -}
guideProgressStorageKey : String
guideProgressStorageKey =
    "onyx:guides-progress-v1"


{-| Download filename for the text plan. -}
roomStarterExportFilename : String
roomStarterExportFilename =
    "onyx-first-room-plan.txt"


{-| Legacy call note replaced by the visible guide wording. -}
legacyCallRecordingNote : String
legacyCallRecordingNote =
    "Calls are opt-in and are not recorded."


{-| The guide's call wording (must stay in sync with the calls
how-to). Exported for the plan-text replacement. -}
callRecordingNote : String
callRecordingNote =
    "Calls are opt-in. Onyx does not automatically record calls. Participants can choose local recording of their own audio when supported."


{-| Safety notes, mirroring `ROOM_STARTER_SAFETY_NOTES`. -}
roomStarterSafetyNotes : List String
roomStarterSafetyNotes =
    [ "Guests can choose a name; an account is optional."
    , "Room messages are shared with everyone in the room. Group rooms are not end-to-end encrypted."
    , "Direct messages are one-to-one. If a private message cannot open, it stays locked instead of turning into plain text."
    , "Calls are opt-in and are not recorded."
    , "Your history and sign-in stay on this device in this browser."
    ]


{-| Visible safety notes: the legacy call note reads with the guide
wording (`GUIDE_SAFETY_NOTES`). -}
safetyNotes : List String
safetyNotes =
    List.map
        (\note ->
            if note == legacyCallRecordingNote then
                callRecordingNote

            else
                note
        )
        roomStarterSafetyNotes


{-| One ordered newcomer step. -}
type alias RoomStarterStep =
    { id : String
    , title : String
    }


{-| A step placed on the route with its number and state. -}
type alias RoomStarterRouteStep =
    { id : String
    , title : String
    , number : Int
    , state : String
    , stateLabel : String
    }


{-| Required how-to ids, in route order. -}
guideStepIds : List String
guideStepIds =
    [ "join", "invite", "messages", "calls", "this-device" ]


{-| Required steps with titles, mirroring `REQUIRED_GUIDE_STEPS`
(the single source for the route, the export, and the "go to"
labels). -}
requiredSteps : List RoomStarterStep
requiredSteps =
    [ { id = "join", title = "Join a room" }
    , { id = "invite", title = "Invite a friend" }
    , { id = "messages", title = "Messages and private DMs" }
    , { id = "calls", title = "Calls when you want them" }
    , { id = "this-device", title = "Keep it on this device" }
    ]


{-| Step title with the oracle's fallback (`guideTitle`). -}
guideStepTitles : String -> String
guideStepTitles id =
    List.filter (\step -> step.id == id) requiredSteps
        |> List.head
        |> Maybe.map .title
        |> Maybe.withDefault "the next step"


{-| The two surfaces sharing this page. -}
type Surface
    = GuidesPage
    | CommunityPage


{-| Surface from a route (`/guides` + `/community`, mirroring
`GUIDES_PATHS`; anything else is `Nothing`). -}
surfaceForRoute : Route -> Maybe Surface
surfaceForRoute route =
    case route of
        Route.Guides ->
            Just GuidesPage

        Route.Community ->
            Just CommunityPage

        _ ->
            Nothing


{-| Path key for frame/meta paths. -}
surfaceKey : Surface -> String
surfaceKey surface =
    case surface of
        GuidesPage ->
            "guides"

        CommunityPage ->
            "community"


{-| Document title, mirroring `GUIDE_PAGE_META`. -}
surfaceTitle : Surface -> String
surfaceTitle surface =
    case surface of
        GuidesPage ->
            "Onyx guides — join a room in the official app"

        CommunityPage ->
            "Onyx community — how to join and be here"


{-| Kicker label, mirroring `GUIDE_PAGE_META`. -}
surfaceKicker : Surface -> String
surfaceKicker surface =
    case surface of
        GuidesPage ->
            "Guides"

        CommunityPage ->
            "Community"


{-| Main landmark label, mirroring `GUIDE_PAGE_META`. -}
surfaceMainLabel : Surface -> String
surfaceMainLabel surface =
    case surface of
        GuidesPage ->
            "Onyx guides"

        CommunityPage ->
            "Onyx community"


{-| Progress summary: completed required count, total, next open id,
and whether the plan is done. Unknown stored ids never count
(`allowedProgressIds`). -}
progressSummary : List String -> List String -> { complete : Int, total : Int, nextId : Maybe String, done : Bool }
progressSummary ids completed =
    let
        allowed =
            List.filter (\id -> List.member id completed) ids
    in
    { complete = List.length allowed
    , total = List.length ids
    , nextId = List.filter (\id -> not (List.member id completed)) ids |> List.head
    , done = List.length allowed == List.length ids
    }


{-| Keep only allowlisted ids in step order, mirroring the
read/write boundary (unknown and duplicate stored ids drop). -}
filterProgressIds : List String -> List String -> List String
filterProgressIds ids completed =
    List.filter (\id -> List.member id completed) ids


{-| Deterministic starter route: done steps, then the first open step
as current, the rest later. Only listed steps can appear — stored
browser data never injects ids. -}
buildRoomStarterRoute : List RoomStarterStep -> List String -> List RoomStarterRouteStep
buildRoomStarterRoute steps completed =
    let
        step hasCurrent index item =
            let
                state =
                    if List.member item.id completed then
                        "done"

                    else if not hasCurrent then
                        "current"

                    else
                        "later"

                label =
                    case state of
                        "done" ->
                            "Done"

                        "current" ->
                            "Start here"

                        _ ->
                            "Then"
            in
            ( hasCurrent || state == "current"
            , { id = item.id
              , title = item.title
              , number = index + 1
              , state = state
              , stateLabel = label
              }
            )

        walk remaining hasCurrent index acc =
            case remaining of
                [] ->
                    List.reverse acc

                item :: rest ->
                    let
                        ( nextCurrent, placed ) =
                            step hasCurrent index item
                    in
                    walk rest nextCurrent (index + 1) (placed :: acc)
    in
    walk steps False 0 []


{-| Local text handoff: header, numbered route, safety notes. No
endpoint, account, or room data. -}
buildRoomStarterExport : List RoomStarterStep -> List String -> String
buildRoomStarterExport steps completed =
    let
        route =
            buildRoomStarterRoute steps completed
    in
    String.join "\n"
        ([ "Onyx first-room plan"
         , "Made in this browser. This plan is not sent anywhere."
         , ""
         , "Route"
         ]
            ++ List.map (\step -> String.fromInt step.number ++ ". " ++ step.title ++ " — " ++ step.stateLabel) route
            ++ [ ""
               , "Privacy and safety"
               ]
            ++ List.map (\note -> "- " ++ note) roomStarterSafetyNotes
        )

module ModAuthority exposing
    ( Actor
    , cardKinds
    , deskKinds
    , isModerator
    , rankOf
    , refusal
    )

{-| v3/gap-people — who may moderate whom, by room role.

Moderation used to be gated on a local "experience level" that Elm
users could not change, so ops never saw the controls. The gate is
now the role the server enforces (Onyx Server `chanmode.zig` /
`handleKick` / `handleMode`):

  - Only operators and above (op, owner, founder — or a network
    operator with override) may KICK or change MODE at all.
  - A moderator may act on members at or below their own rank, never
    above it ("Cannot kick a higher-ranked member", "Cannot change the
    modes of a higher-ranked member"). Changing yourself is not a
    moderation action here.
  - A network operator (`Y`, the derived `*` prefix) can only be
    removed by another network operator.

Ranks reuse `Modes.statusRank` (Y > Q > q > a > o > h > v), so a
server with admin/half-op tiers keeps the same ordering.

-}

import Moderation exposing (ModerationKind(..))
import Modes
import Set exposing (Set)


{-| The acting user in one room. -}
type alias Actor =
    { modes : Set Char
    , networkOperator : Bool
    }


{-| Highest status rank a member holds (0 = plain member). -}
rankOf : Set Char -> Int
rankOf modes =
    Set.foldl (\mode best -> max best (Modes.statusRank mode)) 0 modes


{-| Operator or above in this room (or a network operator). -}
isModerator : Actor -> Bool
isModerator actor =
    actor.networkOperator || rankOf actor.modes >= Modes.statusRank 'o'


{-| Everything a moderator can stage from the room desk before a
target is known; a plain member gets nothing. -}
deskKinds : Actor -> List ModerationKind
deskKinds actor =
    if isModerator actor then
        [ Kick, Ban, Op, Deop, Voice, Devoice ]

    else
        []


{-| Why `actor` may not apply `kind` to a member holding `target`
modes, or `Nothing` when the server would allow it. -}
refusal : Actor -> Set Char -> ModerationKind -> Maybe String
refusal actor target kind =
    if not (isModerator actor) then
        Just "Only room moderators can do that."

    else if Set.member 'Y' target && not actor.networkOperator then
        Just "Network operators can only be moderated by another network operator."

    else if not actor.networkOperator && rankOf target > rankOf actor.modes then
        Just "They rank above you in this room."

    else
        case kind of
            Deop ->
                if rankOf target < Modes.statusRank 'o' then
                    Just "They are not a moderator."

                else
                    Nothing

            Op ->
                if rankOf target >= Modes.statusRank 'o' then
                    Just "They are already a moderator."

                else
                    Nothing

            Voice ->
                if Set.member 'v' target then
                    Just "They can already speak."

                else
                    Nothing

            Devoice ->
                if Set.member 'v' target then
                    Nothing

                else
                    Just "They do not have speak."

            _ ->
                Nothing


{-| Member-card controls in display order: the role toggles that fit
the target's current state, then Kick and Ban. Empty for non-moderators
and for people who outrank the actor. -}
cardKinds : Actor -> Set Char -> List ModerationKind
cardKinds actor target =
    [ if rankOf target >= Modes.statusRank 'o' then
        Deop

      else
        Op
    , if Set.member 'v' target then
        Devoice

      else
        Voice
    , Kick
    , Ban
    ]
        |> List.filter (\kind -> refusal actor target kind == Nothing)

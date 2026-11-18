
* User Exit : ZPTP_PO
* Enhancement Assignment : M06E0005
* Function Exit/Name :   EXIT_SAPLEBNF_005
* INCLUDE : ZXM06U51 .


TYPES: BEGIN OF ly_agr_role,
         agr_name TYPE agr_users-agr_name,
       END OF ly_agr_role.
DATA lt_agr_role TYPE TABLE OF ly_agr_role.
SELECT SINGLE land1 FROM t001 INTO @DATA(lv_land)
WHERE bukrs = @i_ekko-bukrs.
IF sy-subrc EQ 0.
  CASE lv_land.
    WHEN 'DE'.
SELECT value3 AS agr_name FROM zutil_value_tab
      INTO TABLE @DATA(lt_role_name)
      WHERE progname = @sy-repid AND
            varname = 'PO_REL' AND
            value1 = @lv_land AND
            value2 = @i_ekko-bsart.
      IF sy-subrc EQ 0.
        lt_agr_role = lt_role_name.
 SELECT uname AS user_name FROM agr_users
          INTO TABLE @DATA(lt_users)
          FOR ALL ENTRIES IN @lt_agr_role
          WHERE agr_name = @lt_agr_role-agr_name.
        IF sy-subrc EQ 0.
          DATA(lv_user_found) = abap_true.
        ENDIF.
      ENDIF.
WHEN OTHERS.
 ENDCASE.
  IF lv_user_found = abap_true.
 LOOP AT lt_users INTO DATA(ls_users).
      APPEND VALUE #( otype = 'US'
                      objid = ls_users-user_name ) TO actor_tab.
    ENDLOOP.
  ENDIF.
ENDIF.

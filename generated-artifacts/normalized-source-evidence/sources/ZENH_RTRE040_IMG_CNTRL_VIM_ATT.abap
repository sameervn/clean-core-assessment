* Functional - /OPT/V_VA2_EXIT_ACTEXE_H_IMAGE--ZENH_RTRE040_IMG_CNTRL_VIM_ATT.
IF sy-tcode EQ '/OPT/VIM_VA2'.
      SELECT SINGLE
      lifnr,
      bukrs,
      begru
      FROM lfb1
      WHERE lifnr EQ @is_doc_hdr-lifnr
      AND   bukrs EQ @is_doc_hdr-bukrs
      INTO @DATA(lwa_lfb1).
      IF sy-subrc EQ 0 AND  lwa_lfb1-begru IS NOT INITIAL.
        AUTHORITY-CHECK OBJECT 'Z_6NX_AP'
        ID 'ACTION' FIELD 'A'.
        IF sy-subrc <> 0.
          EXIT.
        ENDIF.
      ENDIF.
    ENDIF.
